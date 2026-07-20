variable "dashboard_name" {
  type        = string
  description = "CloudWatch dashboard name."
}

variable "metric_namespace" {
  type        = string
  description = "Custom metric namespace."
}

output "dashboard_name" {
  value = var.dashboard_name
}
