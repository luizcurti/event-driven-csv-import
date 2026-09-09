variable "web_acl_name" {
  type        = string
  description = "WAF web ACL name."
}

variable "api_gateway_stage_arn" {
  type        = string
  description = "API Gateway stage ARN to associate the web ACL with."
}

variable "use_localstack" {
  type        = bool
  description = "WAFv2 is not supported by LocalStack Community, so the ACL and association are skipped when true."
  default     = false
}

resource "aws_wafv2_web_acl" "this" {
  count       = var.use_localstack ? 0 : 1
  name        = var.web_acl_name
  scope       = "REGIONAL"
  description = "Rate limiting web ACL protecting the imports API."

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.web_acl_name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.web_acl_name
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "api_gateway" {
  count        = var.use_localstack ? 0 : 1
  resource_arn = var.api_gateway_stage_arn
  web_acl_arn  = aws_wafv2_web_acl.this[0].arn
}

output "web_acl_name" {
  value = var.web_acl_name
}

output "web_acl_arn" {
  value = var.use_localstack ? "" : aws_wafv2_web_acl.this[0].arn
}
