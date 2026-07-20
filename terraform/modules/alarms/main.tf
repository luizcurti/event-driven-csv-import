variable "alarm_prefix" {
  type        = string
  description = "Alarm name prefix."
}

variable "dashboard_name" {
  type        = string
  description = "Related CloudWatch dashboard."
}

output "alarm_prefix" {
  value = var.alarm_prefix
}
