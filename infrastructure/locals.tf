locals {
  effective_subscription_id = trimspace(var.subscription_id) == "" ? null : trimspace(var.subscription_id)

  waitlist_sender_email = "${var.email_sender_username}@${var.email_domain_name}"

  waitlist_allowed_origins = join(
    ",",
    [
      "https://bomkeeper.dev",
      "https://www.bomkeeper.dev",
      "https://${var.static_web_app_default_hostname}",
    ]
  )

  static_web_app_settings = {
    WAITLIST_STORAGE_CONNECTION_STRING = azurerm_storage_account.waitlist.primary_connection_string
    WAITLIST_TABLE                     = var.waitlist_table_name
    WAITLIST_LIMITS_TABLE              = var.waitlist_limits_table_name
    WAITLIST_EMAIL_CONNECTION_STRING   = azurerm_communication_service.acs.primary_connection_string
    WAITLIST_SENDER                    = local.waitlist_sender_email
    WAITLIST_BASE_URL                  = var.waitlist_base_url
    WAITLIST_EMAIL_ENABLED             = var.email_domain_verified ? "true" : "false"
    WAITLIST_TOKEN_SECRET              = random_password.waitlist_token_secret.result
    WAITLIST_HOURLY_EMAIL_LIMIT        = tostring(var.waitlist_hourly_email_limit)
    WAITLIST_ALLOWED_ORIGINS           = local.waitlist_allowed_origins
  }
}
