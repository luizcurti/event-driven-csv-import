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
  state_machine_name       = "${local.name_prefix}-orchestration"
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
  source     = "./modules/sqs"
  queue_name = "${local.name_prefix}-processing"
  dlq_name   = "${local.name_prefix}-processing-dlq"
}

module "iam" {
  source = "./modules/iam"

  name_prefix              = local.name_prefix
  aws_region               = var.aws_region
  imports_bucket_arn       = module.s3.bucket_arn
  imports_table_arn        = module.dynamodb.table_arn
  processing_queue_arn     = module.sqs.queue_arn
  processing_dlq_arn       = module.sqs.dlq_arn
  aggregator_function_name = local.aggregator_function_name
  split_function_name      = local.split_function_name
  state_machine_name       = local.state_machine_name
}

module "lambda_upload" {
  source   = "./modules/lambda"
  name     = local.upload_function_name
  handler  = "lambdas/upload/entry.handler"
  runtime  = "nodejs20.x"
  timeout  = 30
  zip_path = var.lambda_zip_path
  role_arn = module.iam.lambda_execution_role_arn
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
    CHUNK_SIZE         = tostring(var.chunk_size)
  }
}

module "lambda_split" {
  source   = "./modules/lambda"
  name     = local.split_function_name
  handler  = "lambdas/split/entry.handler"
  runtime  = "nodejs20.x"
  timeout  = 60
  zip_path = var.lambda_zip_path
  role_arn = module.iam.lambda_execution_role_arn
  environment = {
    IMPORTS_BUCKET       = module.s3.bucket_name
    IMPORTS_TABLE_NAME   = module.dynamodb.table_name
    CHUNK_SIZE           = tostring(var.chunk_size)
    PROCESSING_QUEUE_URL = module.sqs.queue_url
  }
}

module "lambda_worker" {
  source   = "./modules/lambda"
  name     = local.worker_function_name
  handler  = "lambdas/worker/entry.handler"
  runtime  = "nodejs20.x"
  timeout  = 120
  zip_path = var.lambda_zip_path
  role_arn = module.iam.lambda_execution_role_arn
  environment = {
    IMPORTS_BUCKET           = module.s3.bucket_name
    IMPORTS_TABLE_NAME       = module.dynamodb.table_name
    WORKER_CONCURRENCY       = tostring(var.worker_concurrency)
    AGGREGATOR_FUNCTION_NAME = local.aggregator_function_name
  }
}

module "lambda_aggregator" {
  source   = "./modules/lambda"
  name     = local.aggregator_function_name
  handler  = "lambdas/aggregator/entry.handler"
  runtime  = "nodejs20.x"
  timeout  = 30
  zip_path = var.lambda_zip_path
  role_arn = module.iam.lambda_execution_role_arn
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
  }
}

module "lambda_status" {
  source   = "./modules/lambda"
  name     = local.status_function_name
  handler  = "lambdas/status/entry.handler"
  runtime  = "nodejs20.x"
  timeout  = 30
  zip_path = var.lambda_zip_path
  role_arn = module.iam.lambda_execution_role_arn
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    IMPORTS_TABLE_NAME = module.dynamodb.table_name
  }
}

resource "aws_lambda_event_source_mapping" "worker_from_queue" {
  event_source_arn        = module.sqs.queue_arn
  function_name           = module.lambda_worker.function_name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

module "apigateway" {
  source = "./modules/apigateway"

  api_name             = "${local.name_prefix}-api"
  upload_function_name = module.lambda_upload.function_name
  upload_invoke_arn    = module.lambda_upload.invoke_arn
  status_function_name = module.lambda_status.function_name
  status_invoke_arn    = module.lambda_status.invoke_arn
}

module "stepfunctions" {
  source = "./modules/stepfunctions"

  state_machine_name = local.state_machine_name
  split_function_arn = module.lambda_split.function_arn
  role_arn           = module.iam.step_functions_execution_role_arn
}

module "eventbridge" {
  source = "./modules/eventbridge"

  bus_name          = local.name_prefix
  bucket_name       = module.s3.bucket_name
  state_machine_arn = module.stepfunctions.state_machine_arn
  invoke_role_arn   = module.iam.eventbridge_invoke_role_arn
}

module "cloudwatch" {
  source = "./modules/cloudwatch"

  dashboard_name   = "${local.name_prefix}-dashboard"
  metric_namespace = var.project_name
  aws_region       = var.aws_region
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

  alarm_prefix = local.name_prefix
  function_names = [
    module.lambda_upload.function_name,
    module.lambda_split.function_name,
    module.lambda_worker.function_name,
    module.lambda_aggregator.function_name,
    module.lambda_status.function_name,
  ]
}

module "waf" {
  source = "./modules/waf"

  web_acl_name          = "${local.name_prefix}-waf"
  api_gateway_stage_arn = module.apigateway.stage_arn
  use_localstack        = var.use_localstack
}

