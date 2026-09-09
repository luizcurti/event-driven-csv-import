variable "bus_name" {
  type        = string
  description = "Logical name used to derive the rule name. S3 notifications always publish to the account default bus, so this rule is attached there."
}

variable "bucket_name" {
  type        = string
  description = "Imports bucket whose Object Created events trigger the Split Lambda."
}

variable "split_function_name" {
  type        = string
  description = "Name of the Split Lambda function invoked by this rule."
}

variable "split_function_arn" {
  type        = string
  description = "ARN of the Split Lambda function invoked by this rule."
}

resource "aws_cloudwatch_event_rule" "object_created" {
  name           = "${var.bus_name}-object-created"
  event_bus_name = "default"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = {
        name = [var.bucket_name]
      }
      object = {
        # Only trigger the pipeline for newly uploaded source files under
        # "incoming/". Without this prefix filter, the split Lambda writing
        # chunk objects to "processing/{importId}/chunk-*.csv" in the same
        # bucket also matches this rule, re-invoking itself in an infinite
        # feedback loop.
        key = [{ prefix = "incoming/" }]
      }
    }
  })
}

# Lambda targets don't need role_arn like Step Functions/Kinesis/ECS targets
# do — EventBridge invokes Lambda via a resource-based permission instead
# (aws_lambda_permission below), the same mechanism API Gateway uses.
resource "aws_cloudwatch_event_target" "invoke_split" {
  rule           = aws_cloudwatch_event_rule.object_created.name
  event_bus_name = "default"
  arn            = var.split_function_arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeSplit"
  action        = "lambda:InvokeFunction"
  function_name = var.split_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.object_created.arn
}

output "bus_name" {
  value = "default"
}

output "rule_name" {
  value = aws_cloudwatch_event_rule.object_created.name
}
