terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Pinned below 5.67.0: that release added a plan-time call to
      # sfn:ValidateStateMachineDefinition, which LocalStack Community does not
      # implement, breaking `aws_sfn_state_machine` against LocalStack.
      version = ">= 5.0, < 5.67.0"
    }
  }
}