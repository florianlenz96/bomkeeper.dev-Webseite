# Bomkeeper Infrastructure (Terraform)

This folder manages infrastructure only:

- Existing Azure Resource Group `rg-bomkeeper-web` (West Europe)
- Existing Azure Static Web App `bomkeeper-web` (Free tier)
- Existing SWA custom domains:
  - `bomkeeper.dev` (apex)
  - `www.bomkeeper.dev`
- New waitlist storage:
  - Storage Account (StorageV2)
  - Table `Waitlist`
  - Table `WaitlistLimits`
- New communication/email infrastructure for double opt-in:
  - Azure Communication Service (ACS)
  - Email Communication Service
  - Customer-managed email domain `bomkeeper.dev`
  - Sender username `waitlist` (display name `Bomkeeper`) gated by verification

No deployment of website/API code is done by Terraform.

---

## What this Terraform config sets on Static Web App

The Static Web App app settings are managed with:

- `WAITLIST_STORAGE_CONNECTION_STRING` = Storage primary connection string
- `WAITLIST_TABLE` = `Waitlist`
- `WAITLIST_LIMITS_TABLE` = `WaitlistLimits`
- `WAITLIST_EMAIL_CONNECTION_STRING` = ACS primary connection string
- `WAITLIST_SENDER` = `waitlist@bomkeeper.dev`
- `WAITLIST_BASE_URL` = `https://bomkeeper.dev` (canonical links)
- `WAITLIST_EMAIL_ENABLED` = `"true"` only when `email_domain_verified=true`, otherwise `"false"`
- `WAITLIST_TOKEN_SECRET` = generated random password (64 chars)
- `WAITLIST_HOURLY_EMAIL_LIMIT` = `"20"` (default)
- `WAITLIST_ALLOWED_ORIGINS` = `https://bomkeeper.dev,https://www.bomkeeper.dev,https://${SWA.default_host_name}`

`WAITLIST_ALLOWED_ORIGINS` supports both custom domains and SWA deployment URL for POST requests from standard HTML forms.
The SWA hostname part is configured via `static_web_app_default_hostname` (default `kind-beach-02c64fb03.3.azurestaticapps.net`).

---

## Prerequisites

- Terraform `>= 1.5` (validated with 1.11.4)
- Azure CLI logged in
- Permission to manage:
  - `Microsoft.Web/staticSites`
  - `Microsoft.Storage/storageAccounts`
  - `Microsoft.Communication/*`
- External DNS provider access (United Domains) for email DNS records

---

## Files

- `versions.tf` provider/version constraints (AzureRM major v4)
- `variables.tf` inputs
- `locals.tf` computed values/app settings
- `main.tf` resources
- `outputs.tf` useful outputs and verification commands
- `terraform.tfvars.example` sample values

---

## Existing resource adoption (safe import path)

This configuration is designed to adopt existing critical resources and protect them with `prevent_destroy`.

1) Create your variables file:

```bash
cd /Users/florianlenz/Downloads/bomkeeper-website/infrastructure
cp terraform.tfvars.example terraform.tfvars
```

2) Set shell vars for import commands:

```bash
export SUBSCRIPTION_ID="35927a95-12bd-4128-8346-ace0cc0491c6"
export RESOURCE_GROUP_NAME="rg-bomkeeper-web"
export STATIC_WEB_APP_NAME="bomkeeper-web"
export ARM_SUBSCRIPTION_ID="$SUBSCRIPTION_ID"
```

3) Initialize Terraform:

```bash
terraform init -backend=false
```

4) Import existing resources:

```bash
terraform import azurerm_resource_group.web "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}"
terraform import azurerm_static_web_app.site "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}/providers/Microsoft.Web/staticSites/${STATIC_WEB_APP_NAME}"
terraform import 'azurerm_static_web_app_custom_domain.domains["bomkeeper.dev"]' "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}/providers/Microsoft.Web/staticSites/${STATIC_WEB_APP_NAME}/customDomains/bomkeeper.dev"
terraform import 'azurerm_static_web_app_custom_domain.domains["www.bomkeeper.dev"]' "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP_NAME}/providers/Microsoft.Web/staticSites/${STATIC_WEB_APP_NAME}/customDomains/www.bomkeeper.dev"
```

> Existing values you provided:
> - SWA ID: `/subscriptions/35927a95-12bd-4128-8346-ace0cc0491c6/resourceGroups/rg-bomkeeper-web/providers/Microsoft.Web/staticSites/bomkeeper-web`
> - External DNS currently expected: apex A `20.101.2.157`, `www` CNAME `kind-beach-02c64fb03.3.azurestaticapps.net`

---

## Fresh deployment path (optional)

If you deploy into a clean subscription/resource names, you can skip import and apply directly.

If DNS is not ready yet, set:

```hcl
manage_static_web_app_custom_domains = false
```

Then enable it later and apply once DNS is in place.

---

## Two-stage apply for custom email domain verification (required)

### Stage 1: Create infra, email domain, DNS verification records; keep email disabled

In `terraform.tfvars`:

```hcl
email_domain_verified = false
```

Run:

```bash
terraform fmt -recursive
terraform validate
terraform plan -out stage1.tfplan
```

Review plan output. It should:

- keep SWA/RG/custom domains managed
- create storage/tables
- create ACS + Email Communication Service
- create Email Communication Service Domain (`CustomerManaged`)
- set `WAITLIST_EMAIL_ENABLED = "false"`
- not create sender username/domain association yet

Do not apply a plan that replaces existing hosting or domains. When the plan is
correct, apply it explicitly:

```bash
terraform apply stage1.tfplan
```

After apply, fetch DNS records to configure at United Domains:

```bash
terraform output email_domain_verification_record_domain
terraform output email_domain_verification_record_spf
terraform output email_domain_verification_record_dkim
terraform output email_domain_verification_record_dkim2
```

Each output includes record `name`, `type`, `value`, `ttl`.

### Stage 1.5: Trigger ACS verification from CLI (exact valid verification types)

After DNS records are added and propagated:

```bash
az communication email domain initiate-verification --resource-group rg-bomkeeper-web --email-service-name bomkeeper-email --domain-name bomkeeper.dev --verification-type Domain
az communication email domain initiate-verification --resource-group rg-bomkeeper-web --email-service-name bomkeeper-email --domain-name bomkeeper.dev --verification-type SPF
az communication email domain initiate-verification --resource-group rg-bomkeeper-web --email-service-name bomkeeper-email --domain-name bomkeeper.dev --verification-type DKIM
az communication email domain initiate-verification --resource-group rg-bomkeeper-web --email-service-name bomkeeper-email --domain-name bomkeeper.dev --verification-type DKIM2
```

Install the CLI extension first if missing:
`az extension add --name communication`.
Keep the existing website A/CNAME and Azure domain-validation TXT records.
Add the email ownership TXT separately. If an SPF TXT record already exists,
merge the Azure mechanism into that one SPF policy rather than publishing a
second SPF record. DKIM records use the hostnames and values from Terraform.

Check status:

```bash
az communication email domain show --resource-group rg-bomkeeper-web --email-service-name bomkeeper-email --domain-name bomkeeper.dev --output json
```

### Stage 2: Enable email resources and email sending flag

Set in `terraform.tfvars`:

```hcl
email_domain_verified = true
```

Run:

```bash
terraform plan -out stage2.tfplan
```

Review plan output. It should:

- create `azurerm_communication_service_email_domain_association`
- create `azurerm_email_communication_service_domain_sender_username` (`waitlist`)
- update SWA app setting `WAITLIST_EMAIL_ENABLED` to `"true"`

This enforces e-mail gating: no sender/domain association and no enabled flag before verification.
The flag is your assertion that verification completed; check all four Azure
verification states report `Verified` before enabling it. Then run:

```bash
terraform apply stage2.tfplan
```

The SWA settings update depends on successful sender provisioning.

---

## Deployment of website/API code (separate from Terraform)

Infrastructure is managed here. Application deployment remains separate via your existing GitHub workflow (`Azure/static-web-apps-deploy`) or manual CLI deploy.

Manual deploy command:

```bash
cd ..
npm --prefix api ci
npm --prefix api test
npx --yes @azure/static-web-apps-cli@2.0.10 deploy ./website --api-location ./api --api-language node --api-version 22 --env production --app-name bomkeeper-web --resource-group rg-bomkeeper-web
```

You can also read these outputs:

- `swa_cli_deploy_command`
- `static_web_app_api_key` (sensitive)

---

## Validation commands

Use before any apply:

```bash
terraform fmt -recursive
terraform init -backend=false
terraform validate
terraform plan
```

`.terraform.lock.hcl` is intentionally kept in version control.

## State, credentials and operations

Terraform state and saved plans contain storage/ACS keys and the token secret,
even when outputs are marked sensitive. They must never be committed. This
project uses local state by default; protect it and its backups. Before using
Terraform from CI or another machine, migrate to a secured Azure Blob remote
backend with restricted access, state locking and recovery enabled.

Storage and email incur usage-based costs. Start with the email limit of 20
per UTC hour, set an Azure budget, and monitor errors and ACS delivery status.
An accepted send operation does not guarantee inbox delivery.

Before launching the form, update the linked privacy policy and schedule the
daily cleanup command documented in [`../api/README.md`](../api/README.md).
No Terraform apply, resource import or production deployment has been performed
as part of creating this project.
