# Event Driven CSV Import

Serverless platform for large-scale CSV imports on AWS. The project keeps the flow simple, fast, and easy to evolve.

## Overview

The system simulates an asynchronous ingestion pipeline with upload, split, parallel processing, aggregation, and status lookup. The repository keeps a clear separation between contracts, business logic, and infrastructure.

## Project Structure

- `lambdas/upload`: API entry point and file validation
- `lambdas/split`: CSV chunking
- `lambdas/worker`: parallel chunk processing
- `lambdas/aggregator`: result consolidation
- `lambdas/status`: import lookup
- `shared`: types, validations, in-memory storage, structured logging, and metrics
- `tests`: unit and end-to-end coverage
- `terraform`: infrastructure as code
- `scripts`: shell helpers for Docker and Terraform workflows
- `postman`: API collection for the implemented routes
- `local`: config for the local observability stack (Prometheus, Grafana, Loki, Promtail)

## Prerequisites

- Node.js 22 or newer
- Docker and Docker Compose
- Terraform

## Quick Start

1. Install dependencies with `npm install`.
2. Run `npm run typecheck` to validate TypeScript.
3. Run `npm run lint` to check code style.
4. Run `npm run format` to check Prettier formatting (`npm run format:fix` to apply it).
5. Run `npm run test:coverage` to run the unit suite with 100% coverage enforcement.
6. Run `npm run test:localstack` to execute the end-to-end flow against LocalStack.

## LocalStack

The repository is ready to run with LocalStack through `docker-compose.local.yml` and the helper scripts in `scripts/`.

1. Start the local stack with `npm run local:up`.
2. Run the end-to-end flow with `npm run test:localstack`.
3. Stop the local stack with `npm run local:down`.

The LocalStack flow uses the following Terraform helpers:

1. `npm run terraform:init`
2. `npm run terraform:fmt`
3. `npm run terraform:validate`
4. `npm run terraform:plan`

The local end-to-end test creates the required bucket and table automatically and exercises the full flow against LocalStack-backed storage.

## Observability (local)

`npm run local:up` also starts a local observability stack alongside LocalStack:

- **Grafana** — http://localhost:3000 (`admin` / `admin`), with a `Lambda overview` dashboard pre-provisioned (invocations, error rate, p95 duration, and logs)
- **Prometheus** — http://localhost:9090
- **Pushgateway** — http://localhost:9091 (Lambdas are short-lived, so each invocation pushes its metrics here instead of being scraped directly)
- **Loki** — logs from every local container, parsed as JSON and filterable by function via the `scope` label (see `shared/logger.ts`)

This is only wired up locally: Lambdas only push metrics when `PUSHGATEWAY_URL` is set, which Terraform only does when `use_localstack = true` (see `terraform/variables.tf`). A real AWS deployment never sets it, so it never attempts to reach a Pushgateway. When applying Terraform locally, pass `-var use_localstack=true` (and `-var localstack_endpoint=...` as needed) so the Lambdas are wired to the local Pushgateway.

## API

The implemented API surface is intentionally small and matches the current Lambda handlers.

- `POST /imports`
- `GET /imports`
- `GET /imports/{id}`

The Postman collection in `postman/event-driven-csv-import.postman_collection.json` mirrors those routes.

## Verification

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

- Typecheck (`npm run typecheck`)
- Lint (`npm run lint`)
- Unit tests with 100% coverage enforcement (`npm run test:coverage`)
- Terraform formatting check (`terraform fmt -check -recursive`)

The following checks are not wired into CI and must be run locally before relying on them:

- Prettier formatting (`npm run format`)
- Terraform init, validation, and plan (`npm run terraform:init` / `terraform:validate` / `terraform:plan`)
- LocalStack end-to-end testing (`npm run local:up` then `npm run test:localstack`)
