variable "bus_name" {
  type        = string
  description = "EventBridge bus name."
}

output "bus_name" {
  value = var.bus_name
}
