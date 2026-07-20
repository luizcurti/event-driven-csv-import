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

output "dashboard_name" {
  value = module.cloudwatch.dashboard_name
}