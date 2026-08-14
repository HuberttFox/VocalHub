# VocaDB Sync Worker

The worker is the only component that calls VocaDB. It reads upstream song and
artist data, validates and normalizes each response, and persists the result to
local PostgreSQL through Prisma. Browser requests and Route Handlers never call
VocaDB; they read only the locally stored catalog.

Every mode runs through `npm run sync:vocadb -- <mode>` and requires
`DATABASE_URL`. Each invocation creates or resumes a durable run persisted as
`SyncRun` and `SyncItem` rows, so an interrupted worker can be continued with
`resume`. A process-wide PostgreSQL advisory lock ensures only one sync worker
runs at a time; a second invocation fails immediately instead of competing.

## Command reference

| Command | What it runs |
| --- | --- |
| `npm run sync:vocadb -- seed` | full song seed (baseline) |
| `npm run sync:vocadb -- incremental` | activity-based song refresh |
| `npm run sync:vocadb -- reconcile` | song deletion reconciliation |
| `npm run sync:vocadb -- resume` | continue the running song run |
| `npm run sync:vocadb -- auto seed` | scheduled song seed (resume-or-create) |
| `npm run sync:vocadb -- auto incremental` | scheduled song refresh (resume-or-create) |
| `npm run sync:vocadb -- auto reconcile` | scheduled song reconcile (resume-or-create) |
| `npm run sync:vocadb -- ids --ids=1,2` | refresh the given VocaDB song IDs |
| `npm run sync:vocadb -- artists refresh` | artist detail refresh |
| `npm run sync:vocadb -- artists resume` | continue the running artist run |
| `npm run sync:vocadb -- artists auto refresh` | scheduled artist refresh (resume-or-create) |
| `npm run sync:vocadb -- artists ids --ids=1,2` | refresh the given local artist IDs |

## Song modes

### `seed`

Full-song baseline. Fetches the complete non-deleted song ID inventory from
VocaDB, creates the durable manifest, then fetches canonical detail for every
ID. On success it records the activity checkpoint and seed completion time. A
completed seed is the prerequisite for `incremental`.

### `incremental`

Activity-based refresh. Discovers changed song IDs from the VocaDB activity
feed inside a window anchored to the last successful checkpoint (with a
configurable overlap) and bounded by a settlement lag, then fetches canonical
detail for each discovered ID. Requires at least one completed seed; otherwise
the run is rejected.

### `reconcile`

Deletion reconciliation. Fetches the full inventory again, computes the diff
against local songs, and re-checks each candidate. Only "absent from the
complete inventory and detail returns 404", or a detail response marked
`deleted: true`, confirms a deletion. Songs are never hard-deleted.

### `resume`

Continues the unique `RUNNING` song run from its durable manifest, processing
only items still pending. Fails if there is no running run or if more than one
running run exists (ambiguous state requires operator intervention).

### `ids --ids=1,2`

Processes exactly the given comma-separated positive VocaDB song IDs as a
bounded one-off run. Every ID must be a positive safe integer.

### `auto seed` / `auto incremental` / `auto reconcile`

The scheduling form of the song modes. If exactly one `RUNNING` song run
exists, it resumes that run; otherwise it creates the requested target mode. It
fails closed when multiple `RUNNING` runs exist so the ambiguity cannot silently
choose a run.

## Artist modes

Artist sync never imports the whole-site artist inventory. It only refreshes
Artists that were established from structured song credits and are associated
with at least one public local song.

### `artists refresh`

Builds a refresh manifest from those eligible Artists, then fetches canonical
detail for each. An Artist enters the manifest when it was never synced, is
`FAILED`, is `SOURCE_MISSING` beyond the refresh cutoff, shows a changed
summary since its last detail sync, or was last synced before the cutoff. The
default cutoff is seven days (`VOCADB_ARTIST_REFRESH_INTERVAL_MS=604800000`).

### `artists resume`

Continues the unique `RUNNING` artist run from its durable manifest. Fails if
there is not exactly one running run.

### `artists auto refresh`

The scheduling form of the artist refresh. Resumes the unique `RUNNING` artist
run when present, otherwise creates a refresh run. Fails closed on multiple
`RUNNING` runs.

### `artists ids --ids=1,2`

Refreshes exactly the given existing local artist source IDs. Unknown local
artist IDs are rejected.

## Durable run behavior

- Each run persists a `SyncRun` record (entity, mode, boundaries, heartbeat,
  status) and per-item `SyncItem` records that form the resumable manifest.
- A run finishes `SUCCEEDED`, `PARTIAL` (some items failed), or `FAILED` (no
  successes). The process exits nonzero for `PARTIAL` or `FAILED` runs.
- The worker updates `lastHeartbeatAt` on the active run every 30 seconds during
  discovery and item processing; a stale heartbeat marks the worker as not
  alive.
- A worker that receives `SIGTERM` or `SIGINT` stops accepting new work, leaves
  the run `RUNNING` and resumable, and exits `130`/`143`. `resume` (or the
  `auto` modes) continues it and clears the recorded error.
- After a song sync that changed the catalog, the worker triggers discovery
  snapshot materialization in a bounded batch. Materialization is maintenance
  work, not part of the VocaDB request path.

## Configuration

All modes require `DATABASE_URL`, the worker's PostgreSQL target. Jobs-only
configuration is limited to `DATABASE_URL` and `VOCADB_*`; the worker reads no
`AUTH_*` values.

- `VOCADB_BASE_URL` — the VocaDB API base. Production (`NODE_ENV=production`)
  requires HTTPS.
- `VOCADB_USER_AGENT` — client identity sent with every request. Production
  requires a non-empty value.
- Optional tuning (defaults shown): `VOCADB_TIMEOUT_MS` (`10000`),
  `VOCADB_ACTIVITY_OVERLAP_MS` (`900000`), `VOCADB_SETTLEMENT_LAG_MS`
  (`120000`), `VOCADB_ARTIST_REFRESH_INTERVAL_MS` (`604800000`),
  `VOCADB_SYNC_CONCURRENCY` (`2`).

Do not copy OAuth credentials into this module's environment. App and OAuth
configuration (including all `AUTH_*` variables) belongs to the app target and
is documented in the [production deployment runbook](../docs/production-deployment-runbook.md).

## Production scheduling

Production runs the `auto` modes under an external scheduler. Scheduler
activation, systemd timer units, seed sequencing, and pause/resume procedures
are documented only in the [production deployment runbook](../docs/production-deployment-runbook.md);
this file does not duplicate them. For local development, use a database you own
and select a mode from the command reference above.
