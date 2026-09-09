variable "alarm_prefix" {
  type        = string
  description = "Alarm name prefix."
}

variable "functions" {
  type = list(object({
    name            = string
    timeout_seconds = number
  }))
  description = "Lambda functions to alarm on, with their configured timeout (used to derive the Duration alarm threshold)."
}

variable "api_name" {
  type        = string
  description = "API Gateway REST API name, for the 4XX/5XX alarms."
}

variable "api_stage_name" {
  type        = string
  description = "API Gateway stage name, for the 4XX/5XX alarms."
}

variable "async_failures_queue_name" {
  type        = string
  description = "Name of the SQS queue that captures failed asynchronous Lambda invocations (Split via EventBridge, Aggregator via the Worker), for the dead-letter alarm."
}

variable "use_localstack" {
  type        = bool
  description = "Whether the stack is targeting LocalStack and should skip alarm creation."
}

locals {
  function_names = { for fn in var.functions : fn.name => fn }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = var.use_localstack ? {} : local.function_names

  alarm_name          = "${var.alarm_prefix}-${each.key}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.key
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = var.use_localstack ? {} : local.function_names

  alarm_name          = "${var.alarm_prefix}-${each.key}-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.key
  }
}

# Fires when the slowest invocation in the period is already within 20% of
# the function's configured timeout, i.e. it's at real risk of being killed
# mid-execution rather than just running a bit slow.
resource "aws_cloudwatch_metric_alarm" "lambda_duration_near_timeout" {
  for_each = var.use_localstack ? {} : local.function_names

  alarm_name          = "${var.alarm_prefix}-${each.key}-duration-near-timeout"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Maximum"
  threshold           = each.value.timeout_seconds * 1000 * 0.8
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.key
  }
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  count = var.use_localstack ? 0 : 1

  alarm_name          = "${var.alarm_prefix}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiName = var.api_name
    Stage   = var.api_stage_name
  }
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_4xx" {
  count = var.use_localstack ? 0 : 1

  alarm_name          = "${var.alarm_prefix}-api-4xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "4XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiName = var.api_name
    Stage   = var.api_stage_name
  }
}

# Covers both failure paths that used to be Step Functions' job to surface:
# a Split invocation EventBridge couldn't deliver, and an Aggregator
# invocation the Worker couldn't deliver. Both land here via dead_letter_config.
resource "aws_cloudwatch_metric_alarm" "async_failures_present" {
  count = var.use_localstack ? 0 : 1

  alarm_name          = "${var.alarm_prefix}-async-invoke-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.async_failures_queue_name
  }
}

output "alarm_prefix" {
  value = var.use_localstack ? "" : var.alarm_prefix
}

output "alarm_names" {
  value = var.use_localstack ? [] : concat(
    [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.lambda_throttles : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.lambda_duration_near_timeout : alarm.alarm_name],
  )
}
