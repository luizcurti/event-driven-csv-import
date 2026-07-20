# Event Driven CSV Import

Serverless platform for large-scale CSV imports on AWS, designed to keep the flow simple, fast, and easy to evolve.

## Goal

The system simulates an asynchronous ingestion pipeline with upload, split, parallel processing, aggregation, and status lookup. The repository keeps a clear separation between contracts, business logic, and infrastructure.

## Structure

- `lambdas/upload`: API entry point and file validation
- `lambdas/split`: CSV chunking
- `lambdas/worker`: parallel chunk processing
- `lambdas/aggregator`: result consolidation
- `lambdas/status`: import lookup
- `shared`: types, validations, in-memory storage, and structured logging
- `tests`: unit and end-to-end coverage
- `terraform`: infrastructure as code scaffold

## Quick Start

1. Install dependencies with `npm install`.
2. Run `npm run typecheck` to validate TypeScript.
3. Run `npm test` for the default suite.
4. Run `npm run test:coverage` to enforce 100% coverage.

## LocalStack

The repository is ready to run with LocalStack through `docker-compose.local.yml` and the helper scripts in `scripts/`.

1. Start LocalStack with `npm run local:up`.
2. Run the local flow with `npm run test:localstack`.
3. Stop LocalStack with `npm run local:down`.
4. Initialize Terraform with `npm run terraform:init`.
5. Format Terraform with `npm run terraform:fmt`.
6. Validate Terraform with `npm run terraform:validate`.
7. Create a Terraform plan with `npm run terraform:plan`.

The local end-to-end test creates the required bucket and table automatically and exercises the full flow against LocalStack-backed storage.

## API

The implemented API surface is intentionally small and matches the current Lambda handlers.

- `POST /imports`
- `GET /imports`
- `GET /imports/{id}`

The Postman collection in `postman/event-driven-csv-import.postman_collection.json` mirrors those routes.

## Architecture Notes

- Code is written in English.
- TypeScript is strict.
- Logging is centralized and structured.
- Shared models and contracts reduce coupling.
- The in-memory implementations keep tests and local development fast.
