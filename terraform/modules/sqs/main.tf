variable "queue_name" {
  type        = string
  description = "Processing queue name."
}

variable "dlq_name" {
  type        = string
  description = "Dead letter queue name."
}

output "queue_name" {
  value = var.queue_name
}

output "dlq_name" {
  value = var.dlq_name
}
