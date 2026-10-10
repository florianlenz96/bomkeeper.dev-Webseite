locals {
  effective_subscription_id = trimspace(var.subscription_id) == "" ? null : trimspace(var.subscription_id)

  waitlist_sender_email = "${var.email_sender_username}@${var.email_domain_name}"

  waitlist_allowed_origins = join(
    ",",
    distinct(concat(
      [trimsuffix(var.waitlist_base_url, "/"), "https://${azurerm_static_web_app.site.default_host_name}"],
      [for domain in keys(var.static_web_app_custom_domains) : "https://${domain}"],
    ))
  )

  static_web_app_settings = {
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.api.connection_string
    WAITLIST_STORAGE_CONNECTION_STRING    = azurerm_storage_account.waitlist.primary_connection_string
    WAITLIST_TABLE                        = var.waitlist_table_name
    WAITLIST_LIMITS_TABLE                 = var.waitlist_limits_table_name
    WAITLIST_EMAIL_CONNECTION_STRING      = azurerm_communication_service.acs.primary_connection_string
    WAITLIST_SENDER                       = local.waitlist_sender_email
    WAITLIST_BASE_URL                     = var.waitlist_base_url
    WAITLIST_EMAIL_ENABLED                = var.email_domain_verified ? "true" : "false"
    WAITLIST_TOKEN_SECRET                 = random_password.waitlist_token_secret.result
    WAITLIST_HOURLY_EMAIL_LIMIT           = tostring(var.waitlist_hourly_email_limit)
    WAITLIST_ALLOWED_ORIGINS              = local.waitlist_allowed_origins
  }
}
