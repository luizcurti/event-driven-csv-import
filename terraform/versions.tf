terraform {
  required_version = ">= 1.10.0"

  backend "s3" {}

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Any 5.x is fine; a future 6.x major is blocked until it's deliberately
      # evaluated. (The config used to require < 5.67.0 to dodge a
      # sfn:ValidateStateMachineDefinition plan-time call LocalStack Community
      # didn't implement — moot now that the config has no
      # aws_sfn_state_machine resource.)
      version = ">= 5.0, < 6.0"
    }
  }
}