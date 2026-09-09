variable "api_name" {
  type        = string
  description = "API Gateway name."
}

variable "stage_name" {
  type        = string
  description = "API Gateway deployment stage name."
  default     = "local"
}

variable "upload_function_name" {
  type        = string
  description = "Name of the upload Lambda function (POST /imports)."
}

variable "upload_invoke_arn" {
  type        = string
  description = "Invoke ARN of the upload Lambda function."
}

variable "status_function_name" {
  type        = string
  description = "Name of the status Lambda function (GET /imports, GET /imports/{id})."
}

variable "status_invoke_arn" {
  type        = string
  description = "Invoke ARN of the status Lambda function."
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log group retention in days for API Gateway access logs."
  default     = 14
}

variable "throttling_rate_limit" {
  type        = number
  description = "Steady-state request rate limit (requests/second) applied to all methods on the stage."
  default     = 50
}

variable "throttling_burst_limit" {
  type        = number
  description = "Burst request limit (concurrent requests) applied to all methods on the stage."
  default     = 100
}

variable "manage_account_settings" {
  type        = bool
  description = "Whether to set the account-level CloudWatch Logs role required for access logging. This is an AWS *account*-wide setting (one per account/region, not per API) — leave false if something else in the account already manages it, to avoid two Terraform configs fighting over the same resource."
  default     = true
}

variable "use_localstack" {
  type        = bool
  description = "Whether the stack is targeting LocalStack. X-Ray tracing and the account-level CloudWatch log role are skipped there, since LocalStack Community doesn't support them."
  default     = false
}

resource "aws_api_gateway_rest_api" "this" {
  name = var.api_name

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_resource" "imports" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "imports"
}

resource "aws_api_gateway_resource" "import_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.imports.id
  path_part   = "{id}"
}

# POST /imports -> upload
resource "aws_api_gateway_method" "create_import" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.imports.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_import" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.imports.id
  http_method             = aws_api_gateway_method.create_import.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.upload_invoke_arn
}

# GET /imports -> status (list)
resource "aws_api_gateway_method" "list_imports" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.imports.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "list_imports" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.imports.id
  http_method             = aws_api_gateway_method.list_imports.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.status_invoke_arn
}

# GET /imports/{id} -> status (get by id)
resource "aws_api_gateway_method" "get_import" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.import_id.id
  http_method   = "GET"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.id" = true
  }
}

resource "aws_api_gateway_integration" "get_import" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.import_id.id
  http_method             = aws_api_gateway_method.get_import.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.status_invoke_arn
}

resource "aws_lambda_permission" "upload_invoke" {
  statement_id  = "AllowAPIGatewayInvokeUpload"
  action        = "lambda:InvokeFunction"
  function_name = var.upload_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "status_invoke" {
  statement_id  = "AllowAPIGatewayInvokeStatus"
  action        = "lambda:InvokeFunction"
  function_name = var.status_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.create_import.id,
      aws_api_gateway_integration.list_imports.id,
      aws_api_gateway_integration.get_import.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.create_import,
    aws_api_gateway_integration.list_imports,
    aws_api_gateway_integration.get_import,
  ]
}

resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/apigateway/${var.api_name}-access-logs"
  retention_in_days = var.log_retention_days
}

# Account-wide setting (one per account/region): grants API Gateway
# permission to write to CloudWatch Logs at all. Required before any stage's
# access_log_settings can take effect.
data "aws_iam_policy_document" "apigateway_cloudwatch_assume" {
  count = var.manage_account_settings && !var.use_localstack ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apigateway_cloudwatch" {
  count              = var.manage_account_settings && !var.use_localstack ? 1 : 0
  name               = "${var.api_name}-apigateway-cloudwatch"
  assume_role_policy = data.aws_iam_policy_document.apigateway_cloudwatch_assume[0].json
}

resource "aws_iam_role_policy_attachment" "apigateway_cloudwatch" {
  count      = var.manage_account_settings && !var.use_localstack ? 1 : 0
  role       = aws_iam_role.apigateway_cloudwatch[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  count               = var.manage_account_settings && !var.use_localstack ? 1 : 0
  cloudwatch_role_arn = aws_iam_role.apigateway_cloudwatch[0].arn
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = var.stage_name
  xray_tracing_enabled = !var.use_localstack

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      caller                  = "$context.identity.caller"
      httpMethod              = "$context.httpMethod"
      resourcePath            = "$context.resourcePath"
      status                  = "$context.status"
      responseLength          = "$context.responseLength"
      requestTime             = "$context.requestTime"
      integrationErrorMessage = "$context.integrationErrorMessage"
    })
  }

  depends_on = [aws_api_gateway_account.this]
}

resource "aws_api_gateway_method_settings" "throttling" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttling_rate_limit
    throttling_burst_limit = var.throttling_burst_limit
    logging_level          = var.use_localstack ? "OFF" : "INFO"
    metrics_enabled        = true
  }
}

output "api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "api_name" {
  value = aws_api_gateway_rest_api.this.name
}

output "execution_arn" {
  value = aws_api_gateway_rest_api.this.execution_arn
}

output "stage_arn" {
  value = aws_api_gateway_stage.this.arn
}

output "stage_name" {
  value = aws_api_gateway_stage.this.stage_name
}

output "invoke_url" {
  value = aws_api_gateway_stage.this.invoke_url
}
