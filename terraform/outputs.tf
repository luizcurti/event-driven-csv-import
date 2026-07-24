output "imports_bucket_name" {
  value = module.s3.bucket_name
}

output "imports_table_name" {
  value = module.dynamodb.table_name
}

output "processing_queue_name" {
  value = module.sqs.queue_name
}

output "api_name" {
  value = module.apigateway.api_name
}

output "api_invoke_url" {
  value = module.apigateway.invoke_url
}

output "state_machine_arn" {
  value = module.stepfunctions.state_machine_arn
}

output "dashboard_name" {
  value = var.use_localstack ? "" : module.cloudwatch[0].dashboard_name
}