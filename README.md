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
- `shared`: types, validations, in-memory storage, and structured logging
- `tests`: unit and end-to-end coverage
- `terraform`: infrastructure as code
- `scripts`: shell helpers for Docker and Terraform workflows
- `postman`: API collection for the implemented routes

## Prerequisites

- Node.js 22 or newer
- Docker and Docker Compose
- Terraform

## Quick Start

1. Install dependencies with `npm install`.
2. Run `npm run typecheck` to validate TypeScript.
3. Run `npm run lint` to check code style.
4. Run `npm run test:coverage` to run the unit suite with 100% coverage enforcement.
5. Run `npm run test:localstack` to execute the end-to-end flow against LocalStack.

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

## API

The implemented API surface is intentionally small and matches the current Lambda handlers.

- `POST /imports`
- `GET /imports`
- `GET /imports/{id}`

The Postman collection in `postman/event-driven-csv-import.postman_collection.json` mirrors those routes.

## Verification

The project is verified with:

- 100% unit test coverage
- LocalStack end-to-end testing
- Terraform init, format, validation, and plan checks

## Architecture Notes

- Code and documentation are written in English.
- TypeScript is strict.
- Logging is centralized and structured.
- Shared models and contracts reduce coupling.
- The in-memory implementations keep tests and local development fast.
