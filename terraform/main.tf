locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

module "s3" {
  source      = "./modules/s3"
  bucket_name = var.imports_bucket_name
}

module "dynamodb" {
  source     = "./modules/dynamodb"
  table_name = "${var.project_name}-${var.environment}-imports"
}

module "sqs" {
  source     = "./modules/sqs"
  queue_name = "${var.project_name}-${var.environment}-processing"
  dlq_name   = "${var.project_name}-${var.environment}-processing-dlq"
}

module "eventbridge" {
  source   = "./modules/eventbridge"
  bus_name = "${var.project_name}-${var.environment}-bus"
}

module "stepfunctions" {
  source              = "./modules/stepfunctions"
  state_machine_name  = "${var.project_name}-${var.environment}-orchestration"
  chunk_size          = var.chunk_size
  queue_name          = module.sqs.queue_name
  imports_bucket_name = module.s3.bucket_name
}

module "iam" {
  source = "./modules/iam"
  role_names = [
    "${var.project_name}-${var.environment}-upload",
    "${var.project_name}-${var.environment}-split",
    "${var.project_name}-${var.environment}-worker",
    "${var.project_name}-${var.environment}-aggregator",
    "${var.project_name}-${var.environment}-status",
  ]
}

module "cloudwatch" {
  source           = "./modules/cloudwatch"
  dashboard_name   = "${var.project_name}-${var.environment}-dashboard"
  metric_namespace = var.project_name
}

module "apigateway" {
  source   = "./modules/apigateway"
  api_name = "${var.project_name}-${var.environment}-api"
  routes   = ["POST /imports", "GET /imports/{id}", "GET /imports"]
}

module "waf" {
  source       = "./modules/waf"
  web_acl_name = "${var.project_name}-${var.environment}-waf"
}

module "alarms" {
  source         = "./modules/alarms"
  alarm_prefix   = "${var.project_name}-${var.environment}"
  dashboard_name = module.cloudwatch.dashboard_name
}

module "lambda_upload" {
  source  = "./modules/lambda"
  name    = "${var.project_name}-${var.environment}-upload"
  handler = "lambdas/upload/handler.createUploadHandler"
  runtime = "nodejs22.x"
  timeout = 30
  environment = {
    IMPORTS_BUCKET = module.s3.bucket_name
    CHUNK_SIZE     = tostring(var.chunk_size)
  }
}

module "lambda_split" {
  source  = "./modules/lambda"
  name    = "${var.project_name}-${var.environment}-split"
  handler = "lambdas/split/handler.createSplitHandler"
  runtime = "nodejs22.x"
  timeout = 60
  environment = {
    IMPORTS_BUCKET = module.s3.bucket_name
    CHUNK_SIZE     = tostring(var.chunk_size)
  }
}

module "lambda_worker" {
  source  = "./modules/lambda"
  name    = "${var.project_name}-${var.environment}-worker"
  handler = "lambdas/worker/handler.createWorkerHandler"
  runtime = "nodejs22.x"
  timeout = 120
  environment = {
    IMPORTS_BUCKET     = module.s3.bucket_name
    WORKER_CONCURRENCY = tostring(var.worker_concurrency)
  }
}

module "lambda_aggregator" {
  source  = "./modules/lambda"
  name    = "${var.project_name}-${var.environment}-aggregator"
  handler = "lambdas/aggregator/handler.createAggregatorHandler"
  runtime = "nodejs22.x"
  timeout = 30
  environment = {
    IMPORTS_BUCKET = module.s3.bucket_name
  }
}

module "lambda_status" {
  source  = "./modules/lambda"
  name    = "${var.project_name}-${var.environment}-status"
  handler = "lambdas/status/handler.createStatusHandler"
  runtime = "nodejs22.x"
  timeout = 30
  environment = {
    IMPORTS_BUCKET = module.s3.bucket_name
  }
}
