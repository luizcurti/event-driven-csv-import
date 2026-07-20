variable "bucket_name" {
  type        = string
  description = "Imports bucket name."
}

output "bucket_name" {
  value = var.bucket_name
}
