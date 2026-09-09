variable "queue_name" {
  type        = string
  description = "Processing queue name."
}

variable "dlq_name" {
  type        = string
  description = "Dead letter queue name."
}

variable "visibility_timeout_seconds" {
  type        = number
  description = "Queue visibility timeout. AWS recommends at least 6x the consuming Lambda's timeout, so an invocation that's still running can't have its message redelivered to another concurrent poller before it finishes."
  default     = 120
}

resource "aws_sqs_queue" "dlq" {
  name                    = var.dlq_name
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "processing" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

output "queue_name" {
  value = aws_sqs_queue.processing.name
}

output "queue_arn" {
  value = aws_sqs_queue.processing.arn
}

output "queue_url" {
  value = aws_sqs_queue.processing.url
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name
}

output "dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}
