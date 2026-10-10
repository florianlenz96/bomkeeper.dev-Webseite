output "resource_group_id" {
  description = "Managed resource group ID."
  value       = azurerm_resource_group.web.id
}

output "static_web_app_id" {
  description = "Static Web App resource ID."
  value       = azurerm_static_web_app.site.id
}

output "static_web_app_name" {
  description = "Static Web App name used by the publishing workflow."
  value       = azurerm_static_web_app.site.name
}

output "resource_group_name" {
  description = "Resource group used by the publishing workflow."
  value       = azurerm_resource_group.web.name
}

output "static_web_app_default_host_name" {
  description = "Static Web App default hostname."
  value       = azurerm_static_web_app.site.default_host_name
}

output "static_web_app_api_key" {
  description = "Static Web App deployment API key (sensitive)."
  value       = azurerm_static_web_app.site.api_key
  sensitive   = true
}

output "waitlist_allowed_origins" {
  description = "Value configured into WAITLIST_ALLOWED_ORIGINS."
  value       = local.waitlist_allowed_origins
}

output "waitlist_sender_email" {
  description = "Configured sender address."
  value       = local.waitlist_sender_email
}

output "waitlist_storage_connection_string" {
  description = "Storage account primary connection string used by the API."
  value       = azurerm_storage_account.waitlist.primary_connection_string
  sensitive   = true
}

output "waitlist_email_connection_string" {
  description = "ACS primary connection string used by the API."
  value       = azurerm_communication_service.acs.primary_connection_string
  sensitive   = true
}

output "waitlist_token_secret" {
  description = "Generated token secret used by the API."
  value       = random_password.waitlist_token_secret.result
  sensitive   = true
}

output "email_domain_verification_record_domain" {
  description = "DNS verification record for Domain verification."
  value       = try(azurerm_email_communication_service_domain.waitlist.verification_records[0].domain[0], null)
}

output "email_domain_verification_record_spf" {
  description = "DNS verification record for SPF verification."
  value       = try(azurerm_email_communication_service_domain.waitlist.verification_records[0].spf[0], null)
}

output "email_domain_verification_record_dkim" {
  description = "DNS verification record for DKIM verification."
  value       = try(azurerm_email_communication_service_domain.waitlist.verification_records[0].dkim[0], null)
}

output "email_domain_verification_record_dkim2" {
  description = "DNS verification record for DKIM2 verification."
  value       = try(azurerm_email_communication_service_domain.waitlist.verification_records[0].dkim2[0], null)
}

output "email_domain_verification_record_dmarc" {
  description = "DNS verification record for DMARC (optional, if returned by Azure)."
  value       = try(azurerm_email_communication_service_domain.waitlist.verification_records[0].dmarc[0], null)
}

output "email_verification_commands" {
  description = "Run these commands after DNS records are added and propagated."
  value = [
    "az communication email domain initiate-verification --resource-group ${var.resource_group_name} --email-service-name ${azurerm_email_communication_service.email.name} --domain-name ${azurerm_email_communication_service_domain.waitlist.name} --verification-type Domain",
    "az communication email domain initiate-verification --resource-group ${var.resource_group_name} --email-service-name ${azurerm_email_communication_service.email.name} --domain-name ${azurerm_email_communication_service_domain.waitlist.name} --verification-type SPF",
    "az communication email domain initiate-verification --resource-group ${var.resource_group_name} --email-service-name ${azurerm_email_communication_service.email.name} --domain-name ${azurerm_email_communication_service_domain.waitlist.name} --verification-type DKIM",
    "az communication email domain initiate-verification --resource-group ${var.resource_group_name} --email-service-name ${azurerm_email_communication_service.email.name} --domain-name ${azurerm_email_communication_service_domain.waitlist.name} --verification-type DKIM2"
  ]
}

output "swa_cli_deploy_command" {
  description = "Manual production deployment command for website + API."
  value       = "npx @azure/static-web-apps-cli@2.0.10 deploy ./website --api-location ./api --api-language node --api-version 22 --env production --app-name ${var.static_web_app_name} --resource-group ${var.resource_group_name}"
}
