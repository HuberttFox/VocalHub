# Development Guide

This guide is the canonical contributor setup for working on VocalHub: prerequisites, environment, local catalog database, validation, and test isolation. Start here, then read the [architecture reference](architecture.md) for system boundaries and the [technical documentation index](README.md) for role-based navigation.

## Prerequisites

- Node.js `>=20.19` (see the `engines` field in `package.json`).
- npm (ships with Node.js).
- Docker and Docker Compose with `--wait` support (Compose v2). `compose.yaml` defines the local PostgreSQL services.
- A `.env` file copied from the `.env.example` template.

Verify the Node version:

```bash
node --version
```

## Environment

Copy the environment template before running any Prisma or application command:

```bash
cp .env.example .env
```

The template defines the local database targets:

- `DATABASE_URL` — default PostgreSQL target.
- `DIRECT_URL` — optional override used first by Prisma when present.
- `TEST_DATABASE_URL` — isolated integration test database.
- `BENCHMARK_DATABASE_URL` — catalog benchmark database.

Prisma commands use `DIRECT_URL` first when present, otherwise `DATABASE_URL` (see `prisma.config.ts`). The template sets both values to the local development database, so no override is needed for day-to-day development.

`AUTH_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET` are placeholders; GitHub OAuth is optional for browsing the local catalog. `VOCADB_USER_AGENT` is preset and required for any sync that contacts VocaDB.

## Local Catalog Database

Start the local development PostgreSQL:

```bash
docker compose up -d --wait postgres
```

The `postgres` service publishes the container on `localhost:5432` with database, user, and password all set to `vocalhub`. The default local target is `postgresql://vocalhub:vocalhub@localhost:5432/vocalhub`. The `--wait` flag blocks until the container healthcheck passes.

## Schema and Initial Catalog Seed

Install dependencies and prepare the database:

```bash
npm ci
npm run db:generate
npm run db:deploy
```

`db:generate` regenerates the Prisma client from `prisma/schema.prisma`; `db:deploy` applies the committed migrations to the `vocalhub` database. Both use `DIRECT_URL` if present, per the Prisma config.

Populate the catalog baseline from VocaDB:

```bash
npm run sync:vocadb -- seed
```

The seed is an explicit step, not an automatic side effect, because it contacts upstream VocaDB (through `VOCADB_BASE_URL` and `VOCADB_USER_AGENT`) and writes the full catalog snapshot into the local database. The worker supports other modes and entity-specific usage; the [worker CLI reference](../worker/README.md) owns those details.

## Run the Application

```bash
npm run dev
```

Then open `http://localhost:3000/`. The public catalog is browsable without logging in.

## Validation

Run the project quality commands:

```bash
npm run lint
npm run test:unit
npm run build
```

Integration tests require the isolated test database. Start it and apply the migrations to it:

```bash
docker compose --profile test up -d --wait postgres-test
DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test DIRECT_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test npm run db:deploy
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test npm run test:integration
```

The `postgres-test` service publishes the container on `localhost:5433`. The overrides point Prisma and the integration tests at the `vocalhub_test` database only, keeping them away from the development database on `5432`.

## Test Isolation

Integration tests target only `vocalhub_test` on port `5433`. They reset the database by deleting rows through Prisma (`deleteMany()`) before each test; they never issue destructive resets. Destructive resets — drops, truncates, or full database resets — are prohibited on the development database (`vocalhub` on `5432`), on any production target, and on the benchmark database (`vocalhub_benchmark` on `5434`). To rebuild the test database, stop the test service and recreate it, then run the migration deploy above; never point a reset at a non-test target.

## Contribution Expectations

Branch and pull request changes should include focused validation appropriate to the changed behavior: the unit tests, integration tests, lint, and build steps relevant to the change, plus the worker or benchmark commands only when the change touches those surfaces. This guide does not claim an unavailable CI policy: there is no standalone `typecheck` script, and the `lint` script scans the full tree. Use the explicit validation commands in this guide.

Related documents:

- [Worker CLI reference](../worker/README.md) — VocaDB synchronization modes and module-specific usage.
- [Catalog benchmark guide](../benchmarks/catalog/README.md) — benchmark execution, datasets, and safety requirements.
- [Production deployment runbook](production-deployment-runbook.md) — production deployment, scheduler operation, and deployment-only commands.
- [Architecture reference](architecture.md) — system boundaries, privacy constraints, and route domains.
- [Technical documentation index](README.md) — role-based documentation navigation.
