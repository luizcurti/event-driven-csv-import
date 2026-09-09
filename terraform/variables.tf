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
  description = "Maximum concurrent Worker Lambda invocations triggered by the processing queue (aws_lambda_event_source_mapping.worker_from_queue's scaling_config.maximum_concurrency)."
  default     = 10

  validation {
    condition     = var.worker_concurrency >= 2 && var.worker_concurrency <= 1000
    error_message = "worker_concurrency must be between 2 and 1000 (the range AWS allows for an event source mapping's scaling_config.maximum_concurrency)."
  }
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

variable "pushgateway_url" {
  type        = string
  description = "Prometheus Pushgateway URL, used only when use_localstack is true (see docker-compose.local.yml)."
  default     = "http://pushgateway:9091"
}

variable "upload_reserved_concurrency" {
  type        = number
  description = "Reserved concurrent executions for the Upload Lambda, carved out of the account's shared pool so a runaway function can't starve the others."
  default     = 20
}

variable "split_reserved_concurrency" {
  type        = number
  description = "Reserved concurrent executions for the Split Lambda."
  default     = 10
}

variable "aggregator_reserved_concurrency" {
  type        = number
  description = "Reserved concurrent executions for the Aggregator Lambda."
  default     = 10
}

variable "status_reserved_concurrency" {
  type        = number
  description = "Reserved concurrent executions for the Status Lambda."
  default     = 20
}

variable "manage_api_gateway_account_settings" {
  type        = bool
  description = "Whether to set the AWS account-level CloudWatch Logs role required for API Gateway access logging. This is an account-wide (not per-API) setting — set to false if another stack in the same account already manages it."
  default     = true
}

variable "api_throttling_rate_limit" {
  type        = number
  description = "Steady-state request rate limit (requests/second) applied to all API Gateway methods."
  default     = 50
}

variable "api_throttling_burst_limit" {
  type        = number
  description = "Burst request limit (concurrent requests) applied to all API Gateway methods."
  default     = 100
}