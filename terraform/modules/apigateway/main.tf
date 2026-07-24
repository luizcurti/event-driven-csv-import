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

resource "aws_api_gateway_rest_api" "this" {
  name = var.api_name
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

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name
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
