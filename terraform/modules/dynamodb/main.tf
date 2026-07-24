variable "table_name" {
  type        = string
  description = "Imports table name."
}

resource "aws_dynamodb_table" "imports" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }
}

output "table_name" {
  value = aws_dynamodb_table.imports.name
}

output "table_arn" {
  value = aws_dynamodb_table.imports.arn
}
