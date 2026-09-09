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
  description = "Invoke URL for the API Gateway stage. The AWS provider's computed aws_api_gateway_stage.invoke_url always renders the real-AWS domain, even against LocalStack, so it is unusable there — use the LocalStack-reachable _user_request_ path instead when use_localstack is true."
  value = (
    var.use_localstack
    ? "${var.localstack_endpoint}/restapis/${module.apigateway.api_id}/${module.apigateway.stage_name}/_user_request_"
    : module.apigateway.invoke_url
  )
}

output "dashboard_name" {
  value = module.cloudwatch.dashboard_name
}