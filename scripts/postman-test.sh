#!/usr/bin/env bash
set -euo pipefail

# Requires the Terraform stack to already be applied (see `npm run terraform:apply`)
# against a reachable API Gateway (LocalStack or real AWS) — this only runs the
# Postman collection against whatever `api_invoke_url` currently resolves to.
#
# Newman is intentionally not a project dependency: its own transitive deps
# (postman-runtime/postman-sandbox) carry long-standing, unfixed high/critical
# advisories that would show up in `npm audit` for every contributor. Running
# it via `npx` keeps it out of package.json and package-lock.json entirely.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_url="$(terraform -chdir="$root_dir/terraform" output -raw api_invoke_url)"

npx --yes newman@6 run "$root_dir/postman/event-driven-csv-import.postman_collection.json" \
  -e "$root_dir/postman/local.postman_environment.json" \
  --env-var "baseUrl=$api_url"
