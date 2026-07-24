variable "alarm_prefix" {
  type        = string
  description = "Alarm name prefix."
}

variable "function_names" {
  type        = list(string)
  description = "Lambda function names to alarm on."
}

variable "use_localstack" {
  type        = bool
  description = "Whether the stack is targeting LocalStack and should skip alarm creation."
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = var.use_localstack ? toset([]) : toset(var.function_names)

  alarm_name          = "${var.alarm_prefix}-${each.value}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }
}

output "alarm_prefix" {
  value = var.use_localstack ? "" : var.alarm_prefix
}

output "alarm_names" {
  value = var.use_localstack ? [] : [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name]
}
