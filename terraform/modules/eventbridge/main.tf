variable "bus_name" {
  type        = string
  description = "Logical name used to derive the rule name. S3 notifications always publish to the account default bus, so this rule is attached there."
}

variable "bucket_name" {
  type        = string
  description = "Imports bucket whose Object Created events trigger the state machine."
}

variable "state_machine_arn" {
  type        = string
  description = "Step Functions state machine ARN to start."
}

variable "invoke_role_arn" {
  type        = string
  description = "IAM role ARN allowing EventBridge to start the state machine execution."
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
        # bucket also matches this rule, starting a new Step Functions
        # execution and re-invoking split in an infinite feedback loop.
        key = [{ prefix = "incoming/" }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "start_execution" {
  rule           = aws_cloudwatch_event_rule.object_created.name
  event_bus_name = "default"
  arn            = var.state_machine_arn
  role_arn       = var.invoke_role_arn
}

output "bus_name" {
  value = "default"
}

output "rule_name" {
  value = aws_cloudwatch_event_rule.object_created.name
}
