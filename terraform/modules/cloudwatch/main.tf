variable "dashboard_name" {
  type        = string
  description = "CloudWatch dashboard name."
}

variable "metric_namespace" {
  type        = string
  description = "Custom metric namespace."
}

variable "aws_region" {
  type        = string
  description = "AWS region for the dashboard widgets."
}

variable "function_names" {
  type        = list(string)
  description = "Lambda function names tracked on the dashboard."
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.dashboard_name

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title   = "Lambda Errors"
          region  = var.aws_region
          stat    = "Sum"
          period  = 60
          metrics = [for name in var.function_names : ["AWS/Lambda", "Errors", "FunctionName", name]]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title   = "Lambda Duration"
          region  = var.aws_region
          stat    = "Average"
          period  = 60
          metrics = [for name in var.function_names : ["AWS/Lambda", "Duration", "FunctionName", name]]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          title   = "Lambda Invocations"
          region  = var.aws_region
          stat    = "Sum"
          period  = 60
          metrics = [for name in var.function_names : ["AWS/Lambda", "Invocations", "FunctionName", name]]
        }
      }
    ]
  })
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.this.dashboard_name
}
