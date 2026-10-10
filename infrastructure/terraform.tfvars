location            = "westeurope"
resource_group_name = "bomkeeper-web"
static_web_app_name = "bomkeeper-web"

storage_account_name = "bomkeeperwaitlist35927"

communication_service_name       = "bomkeeper-acs"
email_communication_service_name = "bomkeeper-email"
communication_data_location      = "Europe"

email_domain_name         = "bomkeeper.dev"
email_sender_username     = "waitlist"
email_sender_display_name = "Bomkeeper"

# Enable only after all email DNS verification states report Verified.
email_domain_verified = true

waitlist_hourly_email_limit = 20
waitlist_base_url           = "https://bomkeeper.dev"

# Enable only after the site's DNS validation records are in place.
manage_static_web_app_custom_domains = false
static_web_app_custom_domains = {
  "bomkeeper.dev"     = "dns-txt-token"
  "www.bomkeeper.dev" = "cname-delegation"
}

tags = {
  project = "bomkeeper"
  env     = "prod"
}
