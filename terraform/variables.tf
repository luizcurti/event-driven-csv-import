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

variable "use_localstack" {
  type        = bool
  description = "Whether to point the AWS provider at a local LocalStack endpoint instead of real AWS."
  default     = false
}

variable "localstack_endpoint" {
  type        = string
  description = "LocalStack endpoint URL, used only when use_localstack is true."
  default     = "http://localhost:4566"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to the packaged Lambda deployment zip (see npm run package:lambdas)."
  default     = "./build/lambda.zip"
}