variable "state_machine_name" {
  type        = string
  description = "Name of the orchestration Step Functions state machine."
}

variable "split_function_arn" {
  type        = string
  description = "ARN of the split Lambda function invoked by the state machine."
}

variable "role_arn" {
  type        = string
  description = "IAM role ARN assumed by the state machine execution."
}

resource "aws_sfn_state_machine" "this" {
  name     = var.state_machine_name
  role_arn = var.role_arn

  definition = jsonencode({
    Comment = "Orchestrates CSV import splitting after an upload is detected."
    StartAt = "Split"
    States = {
      Split = {
        Type     = "Task"
        Resource = var.split_function_arn
        End      = true
      }
    }
  })
}

output "state_machine_arn" {
  value = aws_sfn_state_machine.this.arn
}

output "state_machine_name" {
  value = aws_sfn_state_machine.this.name
}
