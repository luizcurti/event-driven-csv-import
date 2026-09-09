variable "bucket_name" {
  type        = string
  description = "Imports bucket name."
}

variable "object_expiration_days" {
  type        = number
  description = "Days after which uploaded source files and processing chunks are expired. Nothing else ever cleans these up, and the DynamoDB imports table (not S3) is the durable record of an import's outcome."
  default     = 30
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

resource "aws_s3_bucket_public_access_block" "imports" {
  bucket                  = aws_s3_bucket.imports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "imports" {
  bucket = aws_s3_bucket.imports.id

  rule {
    id     = "expire-processed-objects"
    status = "Enabled"

    filter {}

    expiration {
      days = var.object_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

output "bucket_name" {
  value = aws_s3_bucket.imports.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.imports.arn
}
