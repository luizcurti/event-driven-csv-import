variable "bucket_name" {
  type        = string
  description = "Imports bucket name."
}

resource "aws_s3_bucket" "imports" {
  bucket        = var.bucket_name
  force_destroy = true
}

# S3 always publishes object notifications to the account's default
# EventBridge bus; the eventbridge module attaches a rule there.
resource "aws_s3_bucket_notification" "eventbridge" {
  bucket      = aws_s3_bucket.imports.id
  eventbridge = true
}

output "bucket_name" {
  value = aws_s3_bucket.imports.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.imports.arn
}
