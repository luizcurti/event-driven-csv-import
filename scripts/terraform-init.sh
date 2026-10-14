#!/usr/bin/env bash
set -euo pipefail

use_remote_backend=false
for argument in "$@"; do
	if [[ "$argument" == -backend-config* ]]; then
		use_remote_backend=true
		break
	fi
done

if [[ "$use_remote_backend" == true ]]; then
	terraform -chdir=terraform init "$@"
else
	terraform -chdir=terraform init -backend=false "$@"
fi