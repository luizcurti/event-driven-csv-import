#!/usr/bin/env bash
set -euo pipefail

# Local state by default (no backend block is committed — see terraform/versions.tf).
# Extra arguments are passed through, e.g. `npm run terraform:init -- -upgrade`.
terraform -chdir=terraform init "$@"
