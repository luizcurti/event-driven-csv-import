variable "api_name" {
  type        = string
  description = "API Gateway name."
}

variable "routes" {
  type        = list(string)
  description = "API routes exposed by the service."
}

output "api_name" {
  value = var.api_name
}

output "routes" {
  value = var.routes
}
