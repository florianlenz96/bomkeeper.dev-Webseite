data "azurerm_client_config" "current" {}

import {
  to = azurerm_resource_group.web
  id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/resourceGroups/${var.resource_group_name}"
}

resource "azurerm_resource_group" "web" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "waitlist_token_secret" {
  length  = 64
  lower   = true
  upper   = true
  numeric = true
  special = false
}

resource "azurerm_storage_account" "waitlist" {
  name                            = var.storage_account_name
  resource_group_name             = azurerm_resource_group.web.name
  location                        = azurerm_resource_group.web.location
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  tags                            = var.tags
}

resource "azurerm_storage_table" "waitlist" {
  name               = var.waitlist_table_name
  storage_account_id = azurerm_storage_account.waitlist.id
}

resource "azurerm_storage_table" "waitlist_limits" {
  name               = var.waitlist_limits_table_name
  storage_account_id = azurerm_storage_account.waitlist.id
}

resource "azurerm_communication_service" "acs" {
  name                = var.communication_service_name
  resource_group_name = azurerm_resource_group.web.name
  data_location       = var.communication_data_location
  tags                = var.tags
}

resource "azurerm_email_communication_service" "email" {
  name                = var.email_communication_service_name
  resource_group_name = azurerm_resource_group.web.name
  data_location       = var.communication_data_location
  tags                = var.tags
}

resource "azurerm_email_communication_service_domain" "waitlist" {
  name                             = var.email_domain_name
  email_service_id                 = azurerm_email_communication_service.email.id
  domain_management                = "CustomerManaged"
  user_engagement_tracking_enabled = false
  tags                             = var.tags
}

resource "azurerm_communication_service_email_domain_association" "waitlist" {
  count = var.email_domain_verified ? 1 : 0

  communication_service_id = azurerm_communication_service.acs.id
  email_service_domain_id  = azurerm_email_communication_service_domain.waitlist.id
}

resource "azurerm_email_communication_service_domain_sender_username" "waitlist" {
  count = var.email_domain_verified ? 1 : 0

  name                    = var.email_sender_username
  email_service_domain_id = azurerm_email_communication_service_domain.waitlist.id
  display_name            = var.email_sender_display_name

  depends_on = [
    azurerm_communication_service_email_domain_association.waitlist
  ]
}

resource "azurerm_static_web_app" "site" {
  name                = var.static_web_app_name
  resource_group_name = azurerm_resource_group.web.name
  location            = azurerm_resource_group.web.location
  sku_tier            = var.static_web_app_sku_tier
  sku_size            = var.static_web_app_sku_size
  tags                = var.tags

  depends_on = [
    azurerm_storage_table.waitlist,
    azurerm_storage_table.waitlist_limits,
    azurerm_email_communication_service_domain_sender_username.waitlist,
  ]

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      app_settings,
      repository_branch,
      repository_url,
    ]
  }
}

resource "azapi_resource_action" "site_settings" {
  type        = "Microsoft.Web/staticSites/config@2022-03-01"
  resource_id = "${azurerm_static_web_app.site.id}/config/appsettings"
  method      = "PUT"
  # Configure after creation so the generated hostname does not cause a cycle.
  body = sensitive({
    properties = local.static_web_app_settings
  })
  response_export_values = []

  depends_on = [
    azurerm_storage_table.waitlist,
    azurerm_storage_table.waitlist_limits,
    azurerm_email_communication_service_domain_sender_username.waitlist,
  ]
}

resource "azurerm_static_web_app_custom_domain" "domains" {
  for_each = var.manage_static_web_app_custom_domains ? var.static_web_app_custom_domains : {}

  static_web_app_id = azurerm_static_web_app.site.id
  domain_name       = each.key
  validation_type   = each.value

  lifecycle {
    prevent_destroy = true
  }
}
