variable "table_name" {
  type        = string
  description = "Imports table name."
}

output "table_name" {
  value = var.table_name
}
