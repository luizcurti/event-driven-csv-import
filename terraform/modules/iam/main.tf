variable "role_names" {
  type        = list(string)
  description = "Application role names."
}

output "role_names" {
  value = var.role_names
}
