locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
  name_prefix = "${var.project_name}-${var.environment}"

  upload_function_name     = "${local.name_prefix}-upload"
  split_function_name      = "${local.name_prefix}-split"
  worker_function_name     = "${local.name_prefix}-worker"
  aggregator_function_name = "${local.name_prefix}-aggregator"
  status_function_name     = "${local.name_prefix}-status"

  # Kept as a single local (rather than two independently hardcoded numbers)
  # so the queue's visibility timeout below can never silently drift out of
  # sync with the Worker Lambda's actual timeout again.
  worker_timeout_seconds = 120
}

module "s3" {
  source      = "./modules/s3"
  bucket_name = var.imports_bucket_name
}

module "dynamodb" {
  source     = "./modules/dynamodb"
  table_name = "${local.name_prefix}-imports"
}

module "sqs" {
  source                     = "./modules/sqs"
  queue_name                 = "${local.name_prefix}-processing"
  dlq_name                   = "${local.name_prefix}-processing-dlq"
  visibility_timeout_seconds = local.worker_timeout_seconds * 6
}

# Captures events from failed *asynchronous* Lambda invocations — in this
# architecture that's only the Worker's fire-and-forget invoke of the
# Aggregator (InvocationType "Event"). This is separate from the SQS
# processing DLQ above, which catches messages a Worker failed to process.
resource "aws_sqs_queue" "async_failures" {
  name                    = "${local.name_prefix}-async-failures-dlq"
  sqs_managed_sse_enabled = true
}

module "iam" {
  source = "./modules/iam"

  name_prefix              = local.name_prefix
  aws_region               = var.aws_region
  imports_bucket_arn       = module.s3.bucket_arn
  imports_table_arn        = module.dynamodb.table_arn
  processing_queue_arn     = module.sqs.queue_arn
  aggregator_function_name = local.aggregator_function_name
  async_failures_queue_arn = aws_sqs_queue.async_failures.arn
}

module "lambda_upload" {
  source                         = "./modules/lambda"
  name                           = local.upload_function_name
  handler                        = "lambdas/upload/entry.handler"
  runtime                        = "nodejs20.x"
  timeout                        = 30
  zip_path                       = var.lambda_zip_path
  role_arn                       = module.iam.lambda_execution_role_arn
  reserved_concurrent_executions = var.upload_reserved_concurrency
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
    CHUNK_SIZE         = tostring(var.chunk_size)
    PUSHGATEWAY_URL    = var.use_localstack ? var.pushgateway_url : ""
  }
}

module "lambda_split" {
  source                         = "./modules/lambda"
  name                           = local.split_function_name
  handler                        = "lambdas/split/entry.handler"
  runtime                        = "nodejs20.x"
  timeout                        = 60
  zip_path                       = var.lambda_zip_path
  role_arn                       = module.iam.lambda_execution_role_arn
  reserved_concurrent_executions = var.split_reserved_concurrency
  dead_letter_target_arn         = aws_sqs_queue.async_failures.arn
  environment = {
    IMPORTS_BUCKET       = module.s3.bucket_name
    IMPORTS_TABLE_NAME   = module.dynamodb.table_name
    CHUNK_SIZE           = tostring(var.chunk_size)
    PROCESSING_QUEUE_URL = module.sqs.queue_url
    PUSHGATEWAY_URL      = var.use_localstack ? var.pushgateway_url : ""
  }
}

module "lambda_worker" {
  source                         = "./modules/lambda"
  name                           = local.worker_function_name
  handler                        = "lambdas/worker/entry.handler"
  runtime                        = "nodejs20.x"
  timeout                        = local.worker_timeout_seconds
  zip_path                       = var.lambda_zip_path
  role_arn                       = module.iam.worker_execution_role_arn
  reserved_concurrent_executions = var.worker_concurrency
  environment = {
    IMPORTS_BUCKET           = module.s3.bucket_name
    IMPORTS_TABLE_NAME       = module.dynamodb.table_name
    WORKER_CONCURRENCY       = tostring(var.worker_concurrency)
    AGGREGATOR_FUNCTION_NAME = local.aggregator_function_name
    PUSHGATEWAY_URL          = var.use_localstack ? var.pushgateway_url : ""
  }
}

module "lambda_aggregator" {
  source                         = "./modules/lambda"
  name                           = local.aggregator_function_name
  handler                        = "lambdas/aggregator/entry.handler"
  runtime                        = "nodejs20.x"
  timeout                        = 30
  zip_path                       = var.lambda_zip_path
  role_arn                       = module.iam.aggregator_execution_role_arn
  reserved_concurrent_executions = var.aggregator_reserved_concurrency
  dead_letter_target_arn         = aws_sqs_queue.async_failures.arn
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
    PUSHGATEWAY_URL    = var.use_localstack ? var.pushgateway_url : ""
  }
}

module "lambda_status" {
  source                         = "./modules/lambda"
  name                           = local.status_function_name
  handler                        = "lambdas/status/entry.handler"
  runtime                        = "nodejs20.x"
  timeout                        = 30
  zip_path                       = var.lambda_zip_path
  role_arn                       = module.iam.status_execution_role_arn
  reserved_concurrent_executions = var.status_reserved_concurrency
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
    PUSHGATEWAY_URL    = var.use_localstack ? var.pushgateway_url : ""
  }
}

resource "aws_lambda_event_source_mapping" "worker_from_queue" {
  event_source_arn        = module.sqs.queue_arn
  function_name           = module.lambda_worker.function_name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]

  # var.worker_concurrency previously only reached the Worker Lambda's own
  # WORKER_CONCURRENCY env var, which nothing in the application code reads —
  # it never actually limited anything. This is the AWS-enforced knob that
  # makes it real: it caps how many concurrent Worker invocations this queue
  # can trigger.
  scaling_config {
    maximum_concurrency = var.worker_concurrency
  }
}

module "apigateway" {
  source = "./modules/apigateway"

  api_name                = "${local.name_prefix}-api"
  upload_function_name    = module.lambda_upload.function_name
  upload_invoke_arn       = module.lambda_upload.invoke_arn
  status_function_name    = module.lambda_status.function_name
  status_invoke_arn       = module.lambda_status.invoke_arn
  use_localstack          = var.use_localstack
  manage_account_settings = var.manage_api_gateway_account_settings
  throttling_rate_limit   = var.api_throttling_rate_limit
  throttling_burst_limit  = var.api_throttling_burst_limit
}

module "eventbridge" {
  source = "./modules/eventbridge"

  bus_name            = local.name_prefix
  bucket_name         = module.s3.bucket_name
  split_function_name = module.lambda_split.function_name
  split_function_arn  = module.lambda_split.function_arn
}

module "cloudwatch" {
  source = "./modules/cloudwatch"

  dashboard_name = "${local.name_prefix}-dashboard"
  aws_region     = var.aws_region
  use_localstack = var.use_localstack
  function_names = [
    module.lambda_upload.function_name,
    module.lambda_split.function_name,
    module.lambda_worker.function_name,
    module.lambda_aggregator.function_name,
    module.lambda_status.function_name,
  ]
}

module "alarms" {
  source = "./modules/alarms"

  alarm_prefix              = local.name_prefix
  use_localstack            = var.use_localstack
  api_name                  = module.apigateway.api_name
  api_stage_name            = module.apigateway.stage_name
  async_failures_queue_name = aws_sqs_queue.async_failures.name
  functions = [
    { name = module.lambda_upload.function_name, timeout_seconds = 30 },
    { name = module.lambda_split.function_name, timeout_seconds = 60 },
    { name = module.lambda_worker.function_name, timeout_seconds = local.worker_timeout_seconds },
    { name = module.lambda_aggregator.function_name, timeout_seconds = 30 },
    { name = module.lambda_status.function_name, timeout_seconds = 30 },
  ]
}

module "waf" {
  source = "./modules/waf"

  web_acl_name          = "${local.name_prefix}-waf"
  api_gateway_stage_arn = module.apigateway.stage_arn
  use_localstack        = var.use_localstack
}

