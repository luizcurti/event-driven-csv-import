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

variable "processing_dlq_arn" {
  type        = string
  description = "ARN of the processing dead letter queue."
}

variable "aggregator_function_name" {
  type        = string
  description = "Name of the aggregator Lambda function, invoked by the worker."
}

variable "split_function_name" {
  type        = string
  description = "Name of the split Lambda function, invoked by Step Functions."
}

variable "state_machine_name" {
  type        = string
  description = "Name of the orchestration Step Functions state machine, started by EventBridge."
}

data "aws_caller_identity" "current" {}

locals {
  aggregator_function_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.aggregator_function_name}"
  split_function_arn      = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.split_function_name}"
  state_machine_arn       = "arn:aws:states:${var.aws_region}:${data.aws_caller_identity.current.account_id}:stateMachine:${var.state_machine_name}"
}

# --- Lambda execution role, shared by all 5 application functions ---

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

data "aws_iam_policy_document" "lambda_application" {
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
    sid       = "SqsAccess"
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.processing_queue_arn, var.processing_dlq_arn]
  }

  statement {
    sid       = "InvokeAggregator"
    actions   = ["lambda:InvokeFunction"]
    resources = [local.aggregator_function_arn]
  }
}

resource "aws_iam_role_policy" "lambda_application" {
  name   = "${var.name_prefix}-lambda-application"
  role   = aws_iam_role.lambda_execution.id
  policy = data.aws_iam_policy_document.lambda_application.json
}

# --- EventBridge role used to start the Step Functions execution ---

data "aws_iam_policy_document" "eventbridge_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eventbridge_invoke" {
  name               = "${var.name_prefix}-eventbridge-invoke"
  assume_role_policy = data.aws_iam_policy_document.eventbridge_assume.json
}

data "aws_iam_policy_document" "eventbridge_start_execution" {
  statement {
    actions   = ["states:StartExecution"]
    resources = [local.state_machine_arn]
  }
}

resource "aws_iam_role_policy" "eventbridge_start_execution" {
  name   = "${var.name_prefix}-eventbridge-start-execution"
  role   = aws_iam_role.eventbridge_invoke.id
  policy = data.aws_iam_policy_document.eventbridge_start_execution.json
}

# --- Step Functions role used to invoke the Split Lambda ---

data "aws_iam_policy_document" "step_functions_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "step_functions_execution" {
  name               = "${var.name_prefix}-stepfunctions-execution"
  assume_role_policy = data.aws_iam_policy_document.step_functions_assume.json
}

data "aws_iam_policy_document" "step_functions_invoke_split" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [local.split_function_arn]
  }
}

resource "aws_iam_role_policy" "step_functions_invoke_split" {
  name   = "${var.name_prefix}-stepfunctions-invoke-split"
  role   = aws_iam_role.step_functions_execution.id
  policy = data.aws_iam_policy_document.step_functions_invoke_split.json
}

output "lambda_execution_role_arn" {
  value = aws_iam_role.lambda_execution.arn
}

output "eventbridge_invoke_role_arn" {
  value = aws_iam_role.eventbridge_invoke.arn
}

output "step_functions_execution_role_arn" {
  value = aws_iam_role.step_functions_execution.arn
}
