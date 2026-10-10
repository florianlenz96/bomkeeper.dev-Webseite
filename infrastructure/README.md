# Bomkeeper Infrastructure (Terraform)

This folder manages infrastructure only:

- Azure Resource Group `rg-bomkeeper-web` (West Europe), new or imported
- Azure Static Web App `bomkeeper-web` (Free tier), new or imported
- Optional SWA custom domains, enabled after DNS is ready:
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

Terraform provisions resources. The GitHub workflow then publishes website/API
code to that exact Static Web App and checks the public website and API.

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
Origins include `waitlist_base_url`, the configured custom domains and the actual
generated SWA hostname. App settings are applied with an AzAPI PUT action after
SWA creation to avoid a Terraform dependency cycle; AzureRM ignores those settings.
The settings endpoint has no GET operation. Reapply the action explicitly with
`terraform apply -replace=azapi_resource_action.site_settings` if settings are
changed outside Terraform; the action does not detect remote settings drift.
Remove the obsolete `static_web_app_default_hostname` input from old variable files.

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
cd /home/runner/work/bomkeeper.dev-Webseite/bomkeeper.dev-Webseite/infrastructure
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
terraform init
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

Use unique resource names and a globally available storage account name. Set
the real subscription ID; the all-zero value in the example is a placeholder.
Skip imports for genuinely new resources, but never use a new empty state to
manage resources already tracked elsewhere.

If DNS is not ready yet, set:

```hcl
manage_static_web_app_custom_domains = false
```

Then enable it later and apply once DNS is in place.
This is now the default. Obtain the new hostname from
`terraform output -raw static_web_app_default_host_name`; do not reuse the old
site's hostname or IP. Use Azure's custom-domain wizard to obtain the apex
validation TXT token, publish it and the website A/ALIAS/CNAME records, then
enable Terraform domain management. Import any bindings created by the wizard.

### GitHub Actions bootstrap (once)

The workflow uses OIDC, not a long-lived Azure credential or a manually copied
SWA token. An Azure administrator must first:

1. Create a separate state resource group, globally unique StorageV2 account
   (HTTPS only, TLS 1.2, no anonymous blob access) and private blob container.
   Enable blob versioning and soft delete. Keep state outside the website
   resource group. Azure Blob provides state locking.
2. Create an Entra application/service principal or user-assigned identity.
   Add a federated credential with issuer `https://token.actions.githubusercontent.com`,
   subject `repo:florianlenz96/bomkeeper.dev-Webseite:environment:production`
   and audience `api://AzureADTokenExchange`.
3. Grant the identity Contributor at the target subscription scope if it must
   create the website resource group, or at a pre-created target resource group
   scope (import that group before applying). Grant Storage Blob Data Contributor
   on the state storage account for backend access. Do not grant Owner.
   Register Microsoft.Web, Microsoft.Storage and Microsoft.Communication.
4. Create the GitHub `production` environment, restrict it to `main`, and
   configure required reviewers where supported. Configure these environment
   variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `TF_STATE_RESOURCE_GROUP`, `TF_STATE_STORAGE_ACCOUNT`, `TF_STATE_CONTAINER`,
   `TF_STATE_KEY` (for example `website-production.tfstate`).
5. Add environment secret `TF_VARS_JSON`: a JSON object with inputs matching
   `terraform.tfvars.example`. Begin with both domain management and email
   verification disabled. Do not include Azure credentials.

For local operations, log in with Azure CLI, set `ARM_SUBSCRIPTION_ID` and
`ARM_USE_AZUREAD=true`, then initialize the same backend:

```bash
terraform init \
  -backend-config="resource_group_name=$TF_STATE_RESOURCE_GROUP" \
  -backend-config="storage_account_name=$TF_STATE_STORAGE_ACCOUNT" \
  -backend-config="container_name=$TF_STATE_CONTAINER" \
  -backend-config="key=$TF_STATE_KEY"
```

If you have local state already, use `terraform init -migrate-state` with those
same arguments and preserve a secured backup. `init -backend=false` is only
for offline validation, not provisioning.

Push changes to `main` or manually run **Provision and deploy website** there.
It tests the API, validates Terraform, applies a saved plan using locked remote
state, retrieves and masks the new site's deployment token, and publishes both
website and managed Node 22 API. Deployment jobs are serialized; PRs only
validate and receive no Azure credentials. Never publish state/plans as artifacts.
If publishing fails after apply, rerun the workflow against the same state.

Stage 1 publishes a working website/API but deliberately returns 503 for signups.
Complete the DNS/email stages below, update `TF_VARS_JSON` with the verified
flags, and run the workflow again before launching the waitlist.

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

- keep SWA/RG managed and custom domains disabled until DNS is ready
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

The GitHub workflow provisions infrastructure before publishing. No
`AZURE_STATIC_WEB_APPS_API_TOKEN` repository secret is needed; its token is read
from the provisioned target. Manual publishing is also supported after apply.

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
terraform init
terraform validate
terraform plan
```

`.terraform.lock.hcl` is intentionally kept in version control.

## State, credentials and operations

Terraform state and saved plans contain storage/ACS keys and the token secret,
even when outputs are marked sensitive. They must never be committed. This
project uses an Azure Blob remote backend with configuration supplied at init;
bootstrap it and migrate existing local state before the first CI apply.

Storage and email incur usage-based costs. Start with the email limit of 20
per UTC hour, set an Azure budget, and monitor errors and ACS delivery status.
An accepted send operation does not guarantee inbox delivery.

Before launching the form, update the linked privacy policy and schedule the
daily cleanup command documented in [`../api/README.md`](../api/README.md).
No Terraform apply, resource import or production deployment has been performed
in this sandbox: Azure credentials and DNS-provider access are required.

The automated smoke check verifies the landing page and expects HTTP 400 with
the API's invalid-link response for a confirmation request without a token.
This exercises API startup/configuration without sending mail or storing personal
data. After email verification, manually test signup from the new default
hostname and custom domain, inbox delivery, confirmation, duplicate signup and
unsubscribe. Check TLS, privacy/imprint links, and the daily cleanup schedule.
The smoke check alone does not prove storage access or email delivery.
