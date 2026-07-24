variable "queue_name" {
  type        = string
  description = "Processing queue name."
}

variable "dlq_name" {
  type        = string
  description = "Dead letter queue name."
}

resource "aws_sqs_queue" "dlq" {
  name = var.dlq_name
}

resource "aws_sqs_queue" "processing" {
  name                       = var.queue_name
  visibility_timeout_seconds = 120

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
