variable "state_machine_name" {
  type        = string
  description = "State machine name."
}

variable "chunk_size" {
  type        = number
  description = "Chunk size used by the orchestration."
}

variable "queue_name" {
  type        = string
  description = "Queue name consumed by workers."
}

variable "imports_bucket_name" {
  type        = string
  description = "Bucket containing the imports."
}

output "state_machine_name" {
  value = var.state_machine_name
}

output "chunk_size" {
  value = var.chunk_size
}
