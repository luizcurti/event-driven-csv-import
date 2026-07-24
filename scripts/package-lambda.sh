#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$root_dir/terraform/build"
package_dir="$build_dir/package"

echo "Building TypeScript..."
(cd "$root_dir" && npm run build)

rm -rf "$package_dir" "$build_dir/lambda.zip"
mkdir -p "$package_dir"

cp -R "$root_dir/dist/lambdas" "$package_dir/lambdas"
cp -R "$root_dir/dist/shared" "$package_dir/shared"

node -e "
const fs = require('node:fs');
const root = require('$root_dir/package.json');
fs.writeFileSync('$package_dir/package.json', JSON.stringify({
  name: 'event-driven-data-ingestion-lambda',
  private: true,
  type: 'module',
  dependencies: root.dependencies,
}, null, 2));
"

echo "Installing production dependencies..."
npm install --omit=dev --no-audit --no-fund --prefix "$package_dir" >/dev/null

echo "Creating zip package..."
(cd "$package_dir" && zip -qr "$build_dir/lambda.zip" .)

echo "Lambda package created at $build_dir/lambda.zip"
