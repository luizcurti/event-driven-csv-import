variable "name" {
  type        = string
  description = "Lambda function name."
}

variable "handler" {
  type        = string
  description = "Lambda handler entry point."
}

variable "runtime" {
  type        = string
  description = "Lambda runtime."
}

variable "timeout" {
  type        = number
  description = "Lambda timeout in seconds."
}

variable "memory_size" {
  type        = number
  description = "Lambda memory size in MB."
  default     = 256
}

variable "environment" {
  type        = map(string)
  description = "Environment variables for the function."
  default     = {}
}

variable "zip_path" {
  type        = string
  description = "Path to the packaged deployment zip."
}

variable "role_arn" {
  type        = string
  description = "IAM role ARN assumed by the function."
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log group retention in days."
  default     = 14
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  function_name    = var.name
  role             = var.role_arn
  handler          = var.handler
  runtime          = var.runtime
  timeout          = var.timeout
  memory_size      = var.memory_size
  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)

  environment {
    variables = var.environment
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "invoke_arn" {
  value = aws_lambda_function.this.invoke_arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
