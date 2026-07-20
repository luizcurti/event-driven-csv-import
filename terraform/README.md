# Terraform Scaffold

This folder contains a lightweight Terraform scaffold for the event-driven CSV ingestion platform.

The goal is to keep the infrastructure structure explicit without locking the repository into a heavy module tree too early. The root module defines the main AWS building blocks and the `modules/` folder keeps each concern isolated.

Environment-specific overrides can live under `environments/dev` and `environments/prod` as the stack evolves.