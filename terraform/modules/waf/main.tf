variable "web_acl_name" {
  type        = string
  description = "WAF web ACL name."
}

output "web_acl_name" {
  value = var.web_acl_name
}
