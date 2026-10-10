variable "subscription_id" {
  description = "Azure subscription ID. Leave empty to use the currently selected Azure CLI subscription."
  type        = string
  default     = ""
}

variable "location" {
  description = "Azure region for regional resources."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Existing resource group name shared by the state storage and website resources."
  type        = string
  default     = "bomkeeper-web"
}

variable "static_web_app_name" {
  description = "Static Web App name."
  type        = string
  default     = "bomkeeper-web"
}

variable "static_web_app_sku_tier" {
  description = "Static Web App SKU tier."
  type        = string
  default     = "Free"
}

variable "static_web_app_sku_size" {
  description = "Static Web App SKU size."
  type        = string
  default     = "Free"
}

variable "static_web_app_custom_domains" {
  description = "Custom domains to manage for the Static Web App with required validation type."
  type        = map(string)
  default = {
    "bomkeeper.dev"     = "dns-txt-token"
    "www.bomkeeper.dev" = "cname-delegation"
  }
}

variable "manage_static_web_app_custom_domains" {
  description = "If false, do not manage static web app custom domains (useful for fresh deployments before DNS is ready)."
  type        = bool
  default     = false
}

variable "storage_account_name" {
  description = "Global-unique storage account name for waitlist table storage."
  type        = string
  default     = "bomkeeperwaitlistsa"

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "storage_account_name must be 3-24 chars, lowercase letters and numbers only."
  }
}

variable "waitlist_table_name" {
  description = "Primary waitlist table name."
  type        = string
  default     = "Waitlist"
}

variable "waitlist_limits_table_name" {
  description = "Waitlist limits table name."
  type        = string
  default     = "WaitlistLimits"
}

variable "waitlist_hourly_email_limit" {
  description = "Hourly email send limit used by the API."
  type        = number
  default     = 20

  validation {
    condition     = var.waitlist_hourly_email_limit >= 1 && var.waitlist_hourly_email_limit <= 1000 && floor(var.waitlist_hourly_email_limit) == var.waitlist_hourly_email_limit
    error_message = "waitlist_hourly_email_limit must be an integer between 1 and 1000."
  }
}

variable "waitlist_base_url" {
  description = "Canonical base URL used in waitlist emails."
  type        = string
  default     = "https://bomkeeper.dev"
}

variable "communication_service_name" {
  description = "Azure Communication Service name."
  type        = string
  default     = "bomkeeper-acs"
}

variable "email_communication_service_name" {
  description = "Email Communication Service name."
  type        = string
  default     = "bomkeeper-email"
}

variable "communication_data_location" {
  description = "Data location for Communication Services and Email Communication Services."
  type        = string
  default     = "Europe"
}

variable "email_domain_name" {
  description = "Customer-managed email domain for ACS email."
  type        = string
  default     = "bomkeeper.dev"
}

variable "email_sender_username" {
  description = "Sender username part before @domain."
  type        = string
  default     = "waitlist"
}

variable "email_sender_display_name" {
  description = "Display name of the sender."
  type        = string
  default     = "Bomkeeper"
}

variable "email_domain_verified" {
  description = "Gate for email-enabled resources. Keep false until domain DNS verification has completed."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
