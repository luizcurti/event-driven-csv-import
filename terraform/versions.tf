terraform {
  # 1.10+ for the S3 backend's native lockfile (use_lockfile), used by the CI/CD deploy job.
  required_version = ">= 1.10.0"

  # No backend block on purpose: local development and the LocalStack CI job use local
  # state. The CI/CD deploy and Destroy workflows write a ci_backend.tf with
  # `backend "s3" {}` right before `terraform init`, pointing at the bucket created by
  # ../bootstrap. Committing the block here would break the LocalStack apply.

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
