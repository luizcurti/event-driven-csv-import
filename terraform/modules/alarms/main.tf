variable "alarm_prefix" {
  type        = string
  description = "Alarm name prefix."
}

variable "function_names" {
  type        = list(string)
  description = "Lambda function names to alarm on."
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = toset(var.function_names)

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
  value = var.alarm_prefix
}

output "alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name]
}
