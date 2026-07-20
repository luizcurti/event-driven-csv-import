variable "project_name" {
  type        = string
  description = "Project name used in resource naming."
  default     = "event-driven-data-ingestion"
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region for the stack."
  default     = "us-east-1"
}

variable "imports_bucket_name" {
  type        = string
  description = "Name of the S3 bucket used to store imports."
  default     = "event-driven-data-ingestion-imports"
}

variable "chunk_size" {
  type        = number
  description = "CSV chunk size used by the split lambda."
  default     = 5000
}

variable "worker_concurrency" {
  type        = number
  description = "Target worker concurrency."
  default     = 10
}