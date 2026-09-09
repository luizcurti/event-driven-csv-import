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

variable "reserved_concurrent_executions" {
  type        = number
  description = "Hard cap on concurrent executions for this function, carved out of the account's shared pool. null leaves it unreserved."
  default     = null
}

variable "dead_letter_target_arn" {
  type        = string
  description = "SQS queue or SNS topic ARN that receives events from failed asynchronous invocations. null disables the dead-letter config."
  default     = null
}

variable "enable_xray" {
  type        = bool
  description = "Whether to enable AWS X-Ray active tracing for this function."
  default     = true
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  function_name                  = var.name
  role                           = var.role_arn
  handler                        = var.handler
  runtime                        = var.runtime
  timeout                        = var.timeout
  memory_size                    = var.memory_size
  filename                       = var.zip_path
  source_code_hash               = filebase64sha256(var.zip_path)
  publish                        = true
  reserved_concurrent_executions = var.reserved_concurrent_executions

  environment {
    variables = var.environment
  }

  tracing_config {
    mode = var.enable_xray ? "Active" : "PassThrough"
  }

  dynamic "dead_letter_config" {
    for_each = var.dead_letter_target_arn == null ? [] : [var.dead_letter_target_arn]
    content {
      target_arn = dead_letter_config.value
    }
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

# Published on every apply (see `publish = true` above) so a numbered,
# immutable version always exists to point traffic-shifting or rollback at,
# without requiring every current caller to be re-wired through it today.
resource "aws_lambda_alias" "live" {
  name             = "live"
  description      = "Stable alias for gradual rollout/rollback, tracking the latest published version."
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version
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

output "alias_name" {
  value = aws_lambda_alias.live.name
}

output "alias_arn" {
  value = aws_lambda_alias.live.arn
}

output "alias_invoke_arn" {
  value = aws_lambda_alias.live.invoke_arn
}

output "version" {
  value = aws_lambda_function.this.version
}
