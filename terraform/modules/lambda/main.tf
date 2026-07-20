variable "name" {
  type        = string
  description = "Lambda function name."
}

variable "handler" {
  type        = string
  description = "Lambda handler entry point."
}

variable "runtime" {
  type        = string
  description = "Lambda runtime."
}

variable "timeout" {
  type        = number
  description = "Lambda timeout in seconds."
}

variable "environment" {
  type        = map(string)
  description = "Environment variables for the function."
  default     = {}
}

output "function_name" {
  value = var.name
}

output "handler" {
  value = var.handler
}

output "runtime" {
  value = var.runtime
}
