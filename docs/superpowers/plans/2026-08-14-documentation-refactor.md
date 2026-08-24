# Documentation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish concise, source-owned documentation for VocalHub without changing application or production behavior.

**Architecture:** Make the root `README.md` a short Chinese product and local-onboarding entry point. Move detailed English technical ownership into `docs/`, retain executable module guidance beside worker and benchmark CLIs, and preserve historical search documents unchanged in an explicit archive.

**Tech Stack:** Markdown, Mermaid, npm, Node.js >=20.19, Docker Compose, systemd, Next.js, Prisma, PostgreSQL.

**Spec:** `/home/hubert/.claude/plans/squishy-zooming-hopcroft.md`

## Global Constraints

- Keep all runtime code, Prisma schema/migrations, generated client files, Compose files, systemd units, timers, and production services unchanged.
- Do not activate schedulers, migrate databases, seed a catalog, call VocaDB, contact external services, or modify external systems.
- Root `README.md` is Chinese; all new technical documentation is English; historical archive files remain byte-for-byte unchanged.
- New canonical diagrams must use fenced `mermaid` blocks.
- User/API request paths never call VocaDB; VocaDB access remains in `worker/` and `src/lib/vocadb/`.
- Public song identifiers are local UUIDs; `vocadbId` remains source identity, not public local identity.
- Never describe `npm run sync:vocadb` without a required mode.
- `compose.production.yaml` owns only `app` and `migrate`; `compose.production.jobs.yaml` owns worker and maintenance commands.
- Benchmark reset-capable commands must name the disposable `_benchmark` database and require `--confirm-reset=<database>`.
- Preserve existing production runbook procedures and benchmark measurements; add only navigation, ownership, and status framing.
- Do not commit, push, or create a PR unless separately authorized.

---

### Task 1: Archive Historical Full-Site-Search Records

**Files:**
- Create: `docs/archive/full-site-search/README.md`
- Move: `docs/superpowers/specs/2026-07-29-full-site-search-design.md` to `docs/archive/full-site-search/2026-07-29-full-site-search-design.md`
- Move: `docs/superpowers/plans/2026-07-29-full-site-search-stage-a.md` to `docs/archive/full-site-search/2026-07-29-full-site-search-stage-a.md`

**Interfaces:**
- Consumes: historical design and staged implementation-plan records.
- Produces: canonical archive paths linked by all new documentation.

- [x] **Step 1: Locate references to old historical paths**

Run:

```bash
rg -n "docs/superpowers/(specs|plans)/2026-07-29-full-site-search" README.md docs worker benchmarks
```

Expected: references are limited to the historical documents themselves and any current links needing repair.

- [x] **Step 2: Move both historical records without editing their contents**

Run:

```bash
mkdir -p docs/archive/full-site-search
mv docs/superpowers/specs/2026-07-29-full-site-search-design.md docs/archive/full-site-search/
mv docs/superpowers/plans/2026-07-29-full-site-search-stage-a.md docs/archive/full-site-search/
```

Expected: both source paths disappear and both archive paths exist.

- [x] **Step 3: Add archive scope notice**

Create `docs/archive/full-site-search/README.md` with this content:

```markdown
# Full-Site Search Archive

These documents are time-stamped historical design and implementation records.
They preserve the planning state at their original dates. Planned paths,
checklists, stage labels, and completion claims are not current project status.

For current behavior, use [architecture](../../architecture.md),
[development](../../development.md), and
[performance evidence](../../performance/README.md).

- [Design: 2026-07-29](2026-07-29-full-site-search-design.md)
- [Stage A plan: 2026-07-29](2026-07-29-full-site-search-stage-a.md)
```

- [x] **Step 4: Repair external links only**

Replace any links outside archived files that target old `docs/superpowers/...` paths with their `docs/archive/full-site-search/...` equivalents. Do not rewrite links inside archived documents; their original relative references are historical content.

- [x] **Step 5: Verify archival integrity**

Run:

```bash
git diff --no-index -- docs/archive/full-site-search/2026-07-29-full-site-search-design.md <(git show HEAD:docs/superpowers/specs/2026-07-29-full-site-search-design.md)
git diff --no-index -- docs/archive/full-site-search/2026-07-29-full-site-search-stage-a.md <(git show HEAD:docs/superpowers/plans/2026-07-29-full-site-search-stage-a.md)
```

Expected: both commands exit `0`, proving moved historical bodies did not change.

### Task 2: Replace Root Product Entry Point

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/README.md`, `docs/development.md`, `docs/architecture.md`, `docs/production-deployment-runbook.md`, `worker/README.md`, and `docs/performance/README.md` created by later tasks.
- Produces: Chinese product overview and five-minute onboarding with first-click links for product users and contributors.

- [x] **Step 1: Write concise Chinese README structure**

Replace current long reference material with these sections:

```markdown
# VocalHub

## 产品定位
## 可用功能
## 五分钟本地启动
## GitHub OAuth
## 发现页与数据新鲜度
## 文档导航
## VocaDB 署名与媒体来源
```

Keep product claims limited to local catalog browsing, search, artist/tag browsing, favorites/playlists, account management, export, and moderation boundary. Do not reproduce route tables, schema details, benchmark procedures, or production operations.

- [x] **Step 2: Document safe local quick start**

Use only these source-backed commands:

```bash
npm ci
cp .env.example .env
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run sync:vocadb -- seed
npm run dev
```

Explain that seed contacts VocaDB and requires a configured `VOCADB_USER_AGENT`; link detailed modes to `worker/README.md`.

- [x] **Step 3: State OAuth and discovery behavior precisely**

Include GitHub OAuth variables `AUTH_SECRET`, `AUTH_URL`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET` as values to set in `.env`; direct production configuration to the runbook.

Use this meaning for discovery copy:

```markdown
匿名访问者获得公开热门结果。登录访问者在不暴露私人关系来源的前提下，获得基于收藏和歌单的本地个性化结果。快照读取由 `DISCOVERY_SNAPSHOT_READS_ENABLED` 控制，属于运营方分阶段启用功能；未启用或快照不新鲜时保留回退新鲜度状态。
```

- [x] **Step 4: Add documentation map and source attribution**

Add links to `docs/README.md`, `docs/development.md`, `docs/architecture.md`, `worker/README.md`, `docs/performance/README.md`, and `docs/production-deployment-runbook.md`.

Retain VocaDB attribution and state that catalog data is synchronized into local PostgreSQL rather than fetched during visitor requests.

- [x] **Step 5: Remove stale and duplicated operations material**

Delete production worker/maintenance command blocks, scheduled-command examples using `compose.production.yaml`, and claim that scheduler or deployment worker support is unimplemented. State only that deployment provisioning and timer activation are operator-owned, with operations details in the runbook.

- [x] **Step 6: Check root scope**

Run:

```bash
rg -n "compose\.production\.yaml.*(worker|maintenance)|尚未实现.*(定时任务|worker)|npm run sync:vocadb([^ -]|$)" README.md
```

Expected: no matches.

### Task 3: Add Technical Index and Architecture Reference

**Files:**
- Create: `docs/README.md`
- Create: `docs/architecture.md`

**Interfaces:**
- Consumes: current routes under `src/app/api/`, account Server Actions, worker entry point, maintenance CLIs, Prisma-backed repositories, and production Compose/systemd ownership.
- Produces: source-of-truth index plus architecture and route-domain reference linked by the root README and runbook.

- [x] **Step 1: Create role-based technical index**

Create `docs/README.md` with sections and links:

```markdown
# VocalHub Technical Documentation

## Contributors
## Operators and Moderators
## Performance Engineers
## Historical Records
## Documentation Ownership
```

Point contributors to `development.md`, `architecture.md`, and `../worker/README.md`; operators/moderators to `production-deployment-runbook.md`; performance engineers to `performance/README.md` and `../benchmarks/catalog/README.md`; historical records to `archive/full-site-search/README.md`; and product readers back to `../README.md`.

State each canonical owner once: development setup, production procedures, performance evidence, module CLI usage, and archive context.

- [x] **Step 2: Add local-first catalog Mermaid diagram**

In `docs/architecture.md`, add this diagram and explain it in adjacent prose:

```mermaid
flowchart LR
  V[VocaDB API] --> W[worker/sync-vocadb.ts]
  W --> N[Validation and normalization]
  N --> DB[(PostgreSQL)]
  DB --> A[Next.js Server Components and Route Handlers]
  DB --> D[Discovery materializer]
  D --> DB
  A --> U[Browser or API consumer]
```

State: request paths do not call VocaDB; durable `SyncRun` and `SyncItem` records belong to worker execution; discovery materialization and cleanup are maintenance work.

- [x] **Step 3: Add production topology Mermaid diagram**

Add this diagram:

```mermaid
flowchart TB
  I[Ingress and TLS outside repository] --> APP[app: compose.production.yaml]
  APP --> DB[(PostgreSQL)]
  MIG[migrate: compose.production.yaml] --> DB
  T[systemd timers] --> JOBS[compose.production.jobs.yaml]
  JOBS --> WORKER[worker auto modes]
  JOBS --> MAINT[maintenance jobs]
  WORKER --> DB
  MAINT --> DB
  WORKER --> V[VocaDB API]
```

State that app Compose owns `app` and `migrate`; jobs Compose owns worker/maintenance one-shot services; systemd activation remains operator-owned.

- [x] **Step 4: Define durable boundaries and privacy constraints**

Add concise sections covering local UUID public identifiers, private favorites/playlists, Auth.js GitHub OAuth, VocaDB access restriction, and deployment-only moderation commands. State that no OpenAPI specification exists because mutable workflows are Server Actions and current route handlers are not a complete REST API.

- [x] **Step 5: Add compact route-domain map**

Document domains, not endpoint implementation details:

```markdown
| Domain | Surface | Boundary |
| --- | --- | --- |
| Public catalog | `/api/songs`, `/api/artists`, `/api/tags` and detail/works routes | local public catalog data |
| Authentication | `/api/auth/[...nextauth]` | Auth.js session and GitHub OAuth |
| Account export | `/api/account/export` | authenticated private account data |
| Health | `/api/health` | service health |
| Operations | `/api/ops/status` | token-protected operational state |
| Account mutations | Server Actions in `src/lib/account/actions.ts` | authenticated private writes |
```

- [x] **Step 6: Verify diagrams and links are canonical**

Run:

```bash
rg -n '```mermaid|VocaDB|compose\.production\.jobs\.yaml|Server Actions|OpenAPI' docs/architecture.md
```

Expected: two Mermaid fences and all listed boundaries appear.

### Task 4: Add Contributor Development Guide

**Files:**
- Create: `docs/development.md`

**Interfaces:**
- Consumes: `package.json`, `.env.example`, `prisma.config.ts`, and `compose.yaml` command contracts.
- Produces: canonical contributor setup, validation, and database-isolation guidance.

- [x] **Step 1: Document prerequisites and environment setup**

Create sections:

```markdown
# Development Guide

## Prerequisites
## Environment
## Local Catalog Database
## Schema and Initial Catalog Seed
## Run the Application
## Validation
## Test Isolation
## Contribution Expectations
```

Require Node.js `>=20.19`, Docker Compose, and a copied `.env` file. State that Prisma commands use `DIRECT_URL` first when present, otherwise `DATABASE_URL`.

- [x] **Step 2: Document local database workflow**

Use these commands:

```bash
docker compose up -d --wait postgres
npm ci
cp .env.example .env
npm run db:generate
npm run db:deploy
npm run sync:vocadb -- seed
npm run dev
```

Explain that default local PostgreSQL target is `postgresql://vocalhub:vocalhub@localhost:5432/vocalhub` and seed is explicit because it contacts upstream VocaDB.

- [x] **Step 3: Document quality commands and isolated integration DB**

Use these exact commands:

```bash
npm run lint
npm run test:unit
docker compose --profile test up -d --wait postgres-test
DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test DIRECT_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test npm run db:deploy
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test npm run test:integration
npm run build
```

State that integration tests target only `vocalhub_test` on port `5433`; destructive resets are prohibited on development, production, or benchmark targets.

- [x] **Step 4: Link specialized module documents**

Link worker modes to `../worker/README.md`, benchmark steps to `../benchmarks/catalog/README.md`, and production procedures to `production-deployment-runbook.md`. State branch/PR changes should include focused validation appropriate to changed behavior, without claiming unavailable CI policy.

- [x] **Step 5: Verify no unsupported quality command was introduced**

Run:

```bash
rg -n 'npm run (typecheck|sync:vocadb)(\s|$)' docs/development.md
```

Expected: no matches; every documented `npm run` script exists in `package.json`.

### Task 5: Add Worker and Benchmark Module Guides

**Files:**
- Create: `worker/README.md`
- Create: `benchmarks/catalog/README.md`

**Interfaces:**
- Consumes: `src/lib/vocadb/sync-cli.ts`, `worker/sync-vocadb.ts`, `benchmarks/catalog/cli.ts`, `benchmarks/catalog/config.ts`, and `compose.yaml`.
- Produces: source-derived CLI guidance without duplicating production scheduler procedures.

- [x] **Step 1: Create worker command reference**

Create `worker/README.md` with command groups:

```bash
npm run sync:vocadb -- seed
npm run sync:vocadb -- incremental
npm run sync:vocadb -- reconcile
npm run sync:vocadb -- resume
npm run sync:vocadb -- auto seed
npm run sync:vocadb -- auto incremental
npm run sync:vocadb -- auto reconcile
npm run sync:vocadb -- ids --ids=1,2
npm run sync:vocadb -- artists refresh
npm run sync:vocadb -- artists resume
npm run sync:vocadb -- artists auto refresh
npm run sync:vocadb -- artists ids --ids=1,2
```

State all modes require `DATABASE_URL`; worker modes create/resume durable runs; production scheduling uses `auto` modes and is documented only in the production runbook.

- [x] **Step 2: Document worker configuration boundaries**

State production requires HTTPS `VOCADB_BASE_URL` and nonempty `VOCADB_USER_AGENT`; do not copy credentials into jobs documentation. Link app/OAuth configuration to the runbook, keeping `AUTH_*` separate from jobs-only configuration.

- [x] **Step 3: Create benchmark safety and execution guide**

Create `benchmarks/catalog/README.md` with this safe start:

```bash
export BENCHMARK_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5434/vocalhub_benchmark
docker compose --profile benchmark up -d --wait postgres-benchmark
npm run benchmark:catalog -- setup --install-pg-trgm
npm run benchmark:catalog -- load --songs=5000 --seed=20260720 --confirm-reset=vocalhub_benchmark
npm run benchmark:catalog -- run --output=.benchmark-results/catalog-5000.json
```

State database name must end in `_benchmark`, must differ from `DATABASE_URL`, `DIRECT_URL`, and `TEST_DATABASE_URL`, and reset-capable commands require exact `--confirm-reset=vocalhub_benchmark` confirmation.

- [x] **Step 4: List supported benchmark commands and scale matrix**

Document `setup`, `load`, `run`, `compare-search-shape`, `compare-discovery-shape --candidate=combined-cte|split-count`, `compare-discovery-algorithm`, `compare`, and `matrix`.

State target matrix is exactly `5000,10000,20000,50000`; raw reports go under ignored `.benchmark-results/`; links to decision evidence go to `../../docs/performance/catalog-index-baseline.md`.

- [x] **Step 5: Verify CLI examples**

Run:

```bash
rg -n 'npm run sync:vocadb -- (seed|incremental|reconcile|resume|auto|ids|artists)' worker/README.md
rg -n 'benchmark:catalog -- (setup|load|run|compare-search-shape|compare-discovery-shape|compare-discovery-algorithm|compare|matrix)' benchmarks/catalog/README.md
```

Expected: every documented mode is accepted by the matching CLI parser.

### Task 6: Add Performance Documentation Index

**Files:**
- Create: `docs/performance/README.md`
- Modify: `docs/performance/catalog-index-baseline.md`

**Interfaces:**
- Consumes: benchmark module guide and existing measurement/evidence document.
- Produces: clear evidence ownership without transforming records into a tutorial.

- [x] **Step 1: Create performance index**

Create `docs/performance/README.md`:

```markdown
# Performance Documentation

Production indexes require recorded benchmark evidence at representative scale.
A valid result may reject a candidate or conclude that no new index is needed.

- [Catalog index baseline and decisions](catalog-index-baseline.md)
- [Benchmark runner and safety requirements](../../benchmarks/catalog/README.md)
- [Production rollout and rollback procedures](../production-deployment-runbook.md)
```

Add concise rules: benchmark only against disposable benchmark DB; do not turn a benchmark candidate into a production migration without separate evidence and operational review.

- [x] **Step 2: Add navigation/status header to baseline evidence**

Prepend a short section before existing measurements:

```markdown
> Historical benchmark evidence and index decisions. This file records measurements; use the [performance index](README.md) for policy, the [benchmark guide](../../benchmarks/catalog/README.md) for execution, and the [production runbook](../production-deployment-runbook.md) for rollout.
```

Do not edit values, dates, comparisons, or conclusions below this header.

- [x] **Step 3: Verify evidence preservation**

Run:

```bash
git diff -- docs/performance/catalog-index-baseline.md
```

Expected: only new navigation/status lines precede existing evidence.

### Task 7: Clarify Production Runbook Navigation and Ownership

**Files:**
- Modify: `docs/production-deployment-runbook.md`

**Interfaces:**
- Consumes: current complete operator procedure and systemd/Compose contracts.
- Produces: canonical production command authority with first-click cross-links.

- [x] **Step 1: Add short navigation block**

Add near title:

```markdown
> Canonical operator procedure. See [product onboarding](../README.md), [architecture](architecture.md), [development](development.md), [worker modes](../worker/README.md), and [performance evidence](performance/README.md).
```

- [x] **Step 2: Add command ownership statement**

Add before first command block:

```markdown
`compose.production.yaml` runs only `app` and `migrate`.
`compose.production.jobs.yaml` runs worker and maintenance services.
All scheduler activation remains an operator action through the included systemd units.
```

- [x] **Step 3: Preserve all procedure blocks**

Do not change existing deployment preflight, migration, scheduler, `/api/ops/status`, alerting, snapshot rollout, cleanup, moderation, rollback, or heartbeat recovery instructions.

- [x] **Step 4: Verify runbook ownership language**

Run:

```bash
rg -n 'compose\.production\.yaml|compose\.production\.jobs\.yaml|Canonical operator procedure' docs/production-deployment-runbook.md
```

Expected: app/migrate and jobs ownership are both explicit; existing job commands remain unchanged.

### Task 8: Cross-Document Link and Claim Validation

**Files:**
- Verify: `README.md`, `docs/**/*.md`, `worker/README.md`, `benchmarks/catalog/README.md`

**Interfaces:**
- Consumes: all documentation changes from Tasks 1-7.
- Produces: checked local links, command integrity, and no stale ownership claims.

- [x] **Step 1: Run local Markdown link checker**

Run this repository-local checker without network access:

```bash
node --input-type=module <<'EOF'
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { globSync } from "glob";
const files = globSync("{README.md,docs/**/*.md,worker/README.md,benchmarks/catalog/README.md}", { nodir: true });
const failures = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) failures.push(`${file}: ${target}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`checked ${files.length} Markdown files`);
EOF
```

Expected: exit `0`. External links are intentionally not fetched.

- [x] **Step 2: Search stale paths and unsafe command forms**

Run:

```bash
rg -n 'docs/superpowers/(specs|plans)/2026-07-29-full-site-search|npm run sync:vocadb([^ -]|$)|compose\.production\.yaml.*(worker|maintenance)|尚未实现.*(定时任务|worker)' README.md docs worker benchmarks
```

Expected: no matches outside unchanged archived documents, which are excluded from current-status assertions.

- [x] **Step 3: Validate command references against owners**

Run:

```bash
rg -n 'npm run (db:generate|db:deploy|sync:vocadb|lint|test:unit|test:integration|build|benchmark:catalog)' README.md docs worker benchmarks
rg -n 'compose\.production(\.jobs)?\.yaml' README.md docs worker benchmarks
```

For each result, check it against `package.json`, `compose.yaml`, `compose.production.yaml`, `compose.production.jobs.yaml`, and systemd `ExecStart` units. Correct any mismatch before continuing.

- [x] **Step 4: Check formatting and changed-file hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; changed paths limited to approved documentation files and archive moves.

### Task 9: Final Documentation Review and Handoff

**Files:**
- Verify: all files changed by Tasks 1-8

**Interfaces:**
- Consumes: complete documentation refactor and validation results.
- Produces: review-ready documentation change set without git integration actions.

- [x] **Step 1: Inspect final diff by document ownership**

Run:

```bash
git diff -- README.md docs worker/README.md benchmarks/catalog/README.md
```

Confirm root README is concise and Chinese; new technical docs are English; archived bodies are unchanged; operational procedures remain owned by the runbook.

- [x] **Step 2: Check audience entry paths**

Manually follow links from root README and `docs/README.md` for these readers: visitor, contributor, operator/moderator, performance engineer, and historical-record reader.

Expected: each reader reaches a first relevant page in one click.

- [x] **Step 3: Request documentation review**

Ask a reviewer to check this diff against `/home/hubert/.claude/plans/squishy-zooming-hopcroft.md`, focusing on command correctness, archival integrity, ownership duplication, language scope, and Mermaid syntax.

- [x] **Step 4: Report validation and git state**

Report local link-check result, stale-claim search result, command-contract check, `git diff --check`, reviewer outcome, and `git status --short`. Do not stage, commit, push, migrate, seed, activate timers, or alter external systems.

## Plan Self-Review

- [x] Scope coverage: tasks cover root onboarding, technical index, architecture diagrams/boundaries/route map, development, runbook navigation, performance ownership, module-local CLIs, archive move, and required verification.
- [x] Historical preservation: Task 1 explicitly moves without editing bodies and verifies byte-equivalence against `HEAD`.
- [x] Command accuracy: Tasks 2, 4, and 5 use source-validated npm, Compose, worker, and benchmark commands; no bare sync invocation is allowed.
- [x] Ownership: root README does not retain production command procedures; runbook remains canonical; module guides remain executable references.
- [x] Constraints: no application, schema, deployment, scheduler, production-service, or external-system edits are planned.
- [x] Placeholder scan: every task specifies files, inputs/outputs, concrete edits, and verification commands.
