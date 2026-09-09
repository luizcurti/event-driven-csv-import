variable "name_prefix" {
  type        = string
  description = "Prefix used to name roles (e.g. project-environment)."
}

variable "aws_region" {
  type        = string
  description = "AWS region for constructing resource ARNs."
}

variable "imports_bucket_arn" {
  type        = string
  description = "ARN of the imports S3 bucket."
}

variable "imports_table_arn" {
  type        = string
  description = "ARN of the imports DynamoDB table."
}

variable "processing_queue_arn" {
  type        = string
  description = "ARN of the processing SQS queue."
}

variable "aggregator_function_name" {
  type        = string
  description = "Name of the aggregator Lambda function, invoked by the worker."
}

variable "async_failures_queue_arn" {
  type        = string
  description = "ARN of the SQS queue that captures failed-async-invocation events (the Split and Aggregator dead_letter_config target)."
}

data "aws_caller_identity" "current" {}

locals {
  aggregator_function_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.aggregator_function_name}"
}

locals {
  xray_policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# --- Lambda execution role, shared by Upload and Split: both need to read
# and write the imports bucket and the imports table; Split also sends to
# the processing queue and, since EventBridge invokes it asynchronously,
# needs permission to forward its own failed invocations to the dead-letter
# queue configured on the function. Worker, Aggregator, and Status get their
# own roles below because their actual AWS access needs differ enough that
# sharing this one would over-grant all of them. ---

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution" {
  name               = "${var.name_prefix}-lambda-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_xray" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = local.xray_policy_arn
}

data "aws_iam_policy_document" "lambda_application_base" {
  statement {
    sid       = "S3Access"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
    resources = [var.imports_bucket_arn, "${var.imports_bucket_arn}/*"]
  }

  statement {
    sid       = "DynamoDbAccess"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:UpdateItem"]
    resources = [var.imports_table_arn, "${var.imports_table_arn}/index/*"]
  }

  statement {
    sid       = "SqsSendAccess"
    actions   = ["sqs:SendMessage"]
    resources = [var.processing_queue_arn]
  }

  # Split is invoked asynchronously by EventBridge, so its own execution
  # role (shared here with Upload) needs permission to forward a failed
  # invocation to the queue configured on its dead_letter_config.
  statement {
    sid       = "DeadLetterAccess"
    actions   = ["sqs:SendMessage"]
    resources = [var.async_failures_queue_arn]
  }
}

resource "aws_iam_role_policy" "lambda_application" {
  name   = "${var.name_prefix}-lambda-application"
  role   = aws_iam_role.lambda_execution.id
  policy = data.aws_iam_policy_document.lambda_application_base.json
}

# --- Worker execution role: reads chunk objects from S3, reads/writes chunk
# and import records in DynamoDB, consumes the processing queue via its event
# source mapping, and invokes the Aggregator once it observes the last chunk
# of an import. ---

resource "aws_iam_role" "worker_execution" {
  name               = "${var.name_prefix}-worker-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "worker_basic_execution" {
  role       = aws_iam_role.worker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "worker_xray" {
  role       = aws_iam_role.worker_execution.name
  policy_arn = local.xray_policy_arn
}

data "aws_iam_policy_document" "worker_application" {
  source_policy_documents = [data.aws_iam_policy_document.lambda_application_base.json]

  statement {
    sid       = "SqsConsumeAccess"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.processing_queue_arn]
  }

  statement {
    sid       = "InvokeAggregator"
    actions   = ["lambda:InvokeFunction"]
    resources = [local.aggregator_function_arn]
  }
}

resource "aws_iam_role_policy" "worker_application" {
  name   = "${var.name_prefix}-worker-application"
  role   = aws_iam_role.worker_execution.id
  policy = data.aws_iam_policy_document.worker_application.json
}

# --- Aggregator execution role: only ever reads and updates the import
# record and its chunk results in DynamoDB (never touches S3 or the
# processing queue), plus permission to forward its own failed async
# invocations to the dead-letter queue configured on the function. ---

resource "aws_iam_role" "aggregator_execution" {
  name               = "${var.name_prefix}-aggregator-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "aggregator_basic_execution" {
  role       = aws_iam_role.aggregator_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "aggregator_xray" {
  role       = aws_iam_role.aggregator_execution.name
  policy_arn = local.xray_policy_arn
}

data "aws_iam_policy_document" "aggregator_application" {
  statement {
    sid       = "DynamoDbAccess"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [var.imports_table_arn, "${var.imports_table_arn}/index/*"]
  }

  statement {
    sid       = "DeadLetterAccess"
    actions   = ["sqs:SendMessage"]
    resources = [var.async_failures_queue_arn]
  }
}

resource "aws_iam_role_policy" "aggregator_application" {
  name   = "${var.name_prefix}-aggregator-application"
  role   = aws_iam_role.aggregator_execution.id
  policy = data.aws_iam_policy_document.aggregator_application.json
}

# --- Status execution role: read-only lookup of import records, nothing
# else — it never writes to DynamoDB, S3, or the queue. ---

resource "aws_iam_role" "status_execution" {
  name               = "${var.name_prefix}-status-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "status_basic_execution" {
  role       = aws_iam_role.status_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "status_xray" {
  role       = aws_iam_role.status_execution.name
  policy_arn = local.xray_policy_arn
}

data "aws_iam_policy_document" "status_application" {
  statement {
    sid       = "DynamoDbReadAccess"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
    resources = [var.imports_table_arn, "${var.imports_table_arn}/index/*"]
  }
}

resource "aws_iam_role_policy" "status_application" {
  name   = "${var.name_prefix}-status-application"
  role   = aws_iam_role.status_execution.id
  policy = data.aws_iam_policy_document.status_application.json
}

output "lambda_execution_role_arn" {
  value = aws_iam_role.lambda_execution.arn
}

output "worker_execution_role_arn" {
  value = aws_iam_role.worker_execution.arn
}

output "aggregator_execution_role_arn" {
  value = aws_iam_role.aggregator_execution.arn
}

output "status_execution_role_arn" {
  value = aws_iam_role.status_execution.arn
}
