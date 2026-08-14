# Production deployment runbook

This runbook covers deployment against an operator-managed PostgreSQL instance. It does not provision PostgreSQL, schedule jobs, or run production commands automatically.

## Preflight

1. Confirm release commit, image digests, database target, maintenance window, and rollback owner. Pin immutable image digests for `app`, `migrate`, `worker`, and `maintenance`; do not rebuild from a dirty tree. Keep `DISCOVERY_SNAPSHOT_READS_ENABLED=false` until the discovery snapshot migration, backfill, and parity checks complete.
2. Pause VocaDB incremental, reconcile, artist refresh, session-cleanup, playlist-report-cleanup, discovery-materializer, and discovery-snapshot-cleanup schedulers. For systemd reference timers, use `systemctl disable --now vocalhub-worker-incremental.timer vocalhub-worker-reconcile.timer vocalhub-worker-artists-refresh.timer vocalhub-session-cleanup.timer vocalhub-playlist-report-cleanup.timer vocalhub-discovery-materializer.timer vocalhub-discovery-snapshot-cleanup.timer`.
3. Wait for active worker and maintenance containers to exit. Check `SyncRun` and `SyncItem` for `RUNNING` ambiguity before proceeding.
4. Verify a current PostgreSQL backup and a tested restore path. Confirm free disk space for additive indexes.
5. Confirm production secrets are separated by target: app Compose receives `DATABASE_URL`, `AUTH_*`, `OPERATIONAL_STATUS_TOKEN`, `VOCALHUB_APP_IMAGE`, and `VOCALHUB_MIGRATE_IMAGE` from its dedicated deployment environment; the jobs-only systemd environment receives `DATABASE_URL`, `VOCADB_*`, `VOCALHUB_WORKER_IMAGE`, and `VOCALHUB_MAINTENANCE_IMAGE`. `DIRECT_URL` is optional for `migrate`.
6. Run release validation in CI or a staging environment:

```bash
npm run test:unit
npm run test:integration
npx tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js <scoped-paths>
npm run build
```

Replace `<scoped-paths>` with the paths changed by the release. The repository has no standalone `typecheck` script and its `lint` script scans the full tree; use the explicit commands above for release validation.

Do not point destructive or migration commands at development, test, or benchmark databases. Verify the database name and host from the deployment environment before execution.

## First deployment

Run migrations before starting app traffic, then seed catalog baseline from the separate jobs Compose file. The normal Compose file exposes the app only on `127.0.0.1`; configure ingress/TLS outside this repository. Seed is only for initial deployment or an operator-approved rebuild:

```bash
docker compose -f compose.production.yaml --profile migrate run --rm migrate
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.jobs.yaml --profile worker run --rm --no-deps worker seed
```

For governance releases, the two migrations `20260803100000_add_playlist_governance` and `20260803110000_retain_playlist_report_targets` are one indivisible deployment unit. Before starting migration 1, disable Playlist/User deletion writes and keep that gate until both migrations and post-migration catalog checks pass. Do not start the new app image, route traffic, or resume schedulers during the intermediate state. Verify `PlaylistReport.targetPlaylistId` is populated and `NOT NULL`, `PlaylistReport.playlistId` is nullable, both `playlistId` and `reporterId` foreign keys use `ON DELETE SET NULL`, and the corresponding columns accept NULL.
Verify app health, login callback, public catalog reads, and seed summary before enabling scheduled jobs.

## Normal release

1. Pause all schedulers and wait for active worker processes to exit.
2. Keep the current app serving only if the migration is backward-compatible; for governance releases, stop new app traffic and Playlist/User deletion writes until both governance migrations finish.
3. Run the migration container once:

```bash
docker compose -f compose.production.yaml --profile migrate run --rm migrate
```

4. Check migration output and application startup logs. Wait for the Compose app health check to report `healthy`; it probes `http://127.0.0.1:3000/api/health` with Node `fetch`. Keep scheduler paused until health checks pass.
5. Deploy the new immutable app image without changing database target. Ingress/TLS configuration remains external to this Compose artifact.
6. Run a read-only smoke check against `/`, `/songs`, `/search`, `/api/songs`, and `/privacy`.
7. Resume schedulers only after migration and smoke checks pass.

For governance releases, also verify an active public share resolves, a hidden public share returns 404, and an authenticated report can be submitted. Test Playlist deletion and account reporter SetNull behavior only with disposable staging fixtures or the isolated integration database; do not delete a real production Playlist during smoke checks. Confirm the fixture leaves `PlaylistReport.playlistId = NULL` and `reporterId = NULL` while retaining `targetPlaylistId`.
Migration failure is a stop condition. Do not mark a migration applied manually unless PostgreSQL catalog state exactly matches the committed migration and the operator has reviewed the recovery path.

## Catalog index rollout

The current production index migrations are additive:

- `20260727120000_add_song_artist_credit_artist_song_partial_index`
- `20260802090000_add_song_tag_tag_song_index`

Before rollout, pause all VocaDB workers and confirm no long-running writers. `CREATE INDEX` can wait on existing writers and holds a `SHARE` lock that blocks catalog writes while it runs. Monitor `pg_stat_progress_create_index` and PostgreSQL lock views. After migration, verify table, key order, predicate, `indisvalid`, and `indisready` for both indexes. Restore scheduler only after checks pass.

If a build fails, inspect PostgreSQL catalogs and Prisma migration history first. Do not blindly rerun, resolve, or drop an index. Any manual `DROP INDEX CONCURRENTLY` must run outside a transaction, be recorded, and be followed by a corrective migration. Run any Prisma migration recovery command from the checked-out release or migration container with explicit production connection variables; do not use an unrelated host Node/npm installation.

## Scheduler operations

External scheduler invokes one-shot containers. Prevent overlapping jobs at scheduler level; PostgreSQL advisory lock remains final worker protection. For the repository systemd reference, copy the units from `deploy/systemd/`, install `/etc/vocalhub/vocalhub.env` with mode `0600`, verify the release path and immutable image/config references, then enable timers only after initial seed and smoke checks:

```bash
sudo install -d -m 0750 /etc/vocalhub
sudo install -m 0644 deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo install -m 0600 /path/to/edited/vocalhub.env /etc/vocalhub/vocalhub.env
sudo systemctl daemon-reload
sudo systemctl enable --now vocalhub-worker-incremental.timer vocalhub-worker-reconcile.timer
sudo systemctl enable --now vocalhub-worker-artists-refresh.timer vocalhub-session-cleanup.timer vocalhub-playlist-report-cleanup.timer vocalhub-discovery-materializer.timer vocalhub-discovery-snapshot-cleanup.timer
```

Use `systemctl status <unit>` and `journalctl -u <unit>` to inspect execution. Nonzero service exits remain visible and alertable. Before any migration or release, pause all seven timers with `systemctl disable --now`; re-enable only after migration, app health, and smoke checks pass. Never activate these timers against an unseeded database. Edit the jobs-only environment file with real values; never install the placeholder example directly. Validate no `db.example`, `user:password`, `replace-with-digest`, or `replace-with-operator-contact` remains. `compose.production.yaml` requires pinned app/migrate image digests and app secrets from a separate deployment environment; `compose.production.jobs.yaml` and its systemd template exclude app, migration, and Auth interpolation and require pinned worker/maintenance image digests.
```bash
docker compose -f compose.production.jobs.yaml --profile worker run --rm --no-deps worker auto incremental
docker compose -f compose.production.jobs.yaml --profile worker run --rm --no-deps worker auto reconcile
docker compose -f compose.production.jobs.yaml --profile worker run --rm --no-deps worker artists auto refresh
docker compose -f compose.production.jobs.yaml --profile maintenance run --rm --no-deps session-cleanup
# After governance migration is deployed:
docker compose -f compose.production.jobs.yaml --profile maintenance run --rm --no-deps playlist-report-cleanup
# After discovery snapshot migration is deployed, backfill before enabling snapshot reads:
docker compose -f compose.production.jobs.yaml --profile maintenance run --rm --no-deps discovery-materializer --limit=100
# Per-profile exact-V1 build timeout defaults to 300000ms and cannot exceed
# 20 minutes. The maintenance batch budget defaults to 24 minutes, leaving
# six minutes before the 30-minute systemd service deadline:
# DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS=300000
# DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS=1440000
# A successful BUDGET_EXHAUSTED result defers untouched stale profiles; its
# JSON/journal output is the batch report. /api/ops/status reports immediately
# claimable queue state: staleProfileCount includes profile-less favorite and
# non-empty playlist candidates, while oldestPendingAt is null when only such
# candidates remain. Fresh active build leases are in-flight work and omitted
# until their lease expires.
# Enable DISCOVERY_SNAPSHOT_READS_ENABLED=true only after snapshot parity and freshness checks.
# Prune non-current terminal snapshots older than seven days; BUILDING and active snapshots are retained:
docker compose -f compose.production.jobs.yaml --profile maintenance run --rm --no-deps discovery-snapshot-cleanup --limit=100

# Operator-only, explicit report queue/disposition:
node build/maintenance/governance/moderate-playlist.js list-reports --limit=50
node build/maintenance/governance/moderate-playlist.js resolve-report <report-uuid> <resolution-code>
node build/maintenance/governance/moderate-playlist.js dismiss-report <report-uuid> <resolution-code>
node build/maintenance/governance/moderate-playlist.js hide <playlist-uuid>

```

Recommended cadence: incremental every 15 minutes, reconcile daily during low traffic, artist refresh daily at a separate time, session cleanup daily, discovery materialization every 30 minutes at offset seven minutes, and discovery snapshot cleanup every 15 minutes at a separate offset. The 30-minute materializer cadence prevents systemd from skipping a timer activation while a 24-minute batch is still active. Capture exit status and JSON output. Alert on nonzero exit, missing daily success, multiple `RUNNING` runs, repeated `FAILED` items, any repeated materializer `failedCount > 0` (including timeout-driven failures), repeated `BUDGET_EXHAUSTED` materializer results or `deferredCount > 0` without backlog reduction, persistent `/api/ops/status` discovery `staleProfileCount`, or repeated cleanup results equal to its batch limit.

Playlist report cleanup removes only `RESOLVED`/`DISMISSED` reports older than 180 days. It must not remove `OPEN` reports. Discovery snapshot cleanup removes only non-current `READY`/`FAILED` snapshots with `finishedAt` older than seven days; it never removes `BUILDING` snapshots, null-finished rows, or active snapshots. Both jobs are idempotent and report JSON counts. The moderation and triage commands are deployment-only and require operator shell/database access.



A worker receiving `SIGTERM` or `SIGINT` stops accepting new work and leaves resumable state. Keep at least 60 seconds termination grace period. `ACTIVITY_INTERVAL_SATURATED` requires a full seed rebuild, not repeated incremental retries.

## Operations status endpoint

`/api/health` is a minimal PostgreSQL readiness probe used by the Compose container healthcheck; it returns `200 {status:"ok"}` once `SELECT 1` succeeds and `503` otherwise. It never loads VocaDB, Auth, or sync state.

`/api/ops/status` is an operator-only, read-only snapshot of sync state:

- Requires `Authorization: Bearer $OPERATIONAL_STATUS_TOKEN`. The token must be a fresh random value of at least 16 characters; the example placeholder from `.env.example` is rejected and the endpoint fails closed rather than serve status. Never store the token in the jobs-only systemd environment or in Git.
- Returns `200` with the full snapshot when classification is `READY`, and `503` for every other classification (`UNSEEDED`, `DEGRADED`, `STALE`) or on database failure.
- Classification order: `UNSEEDED` (no completed song seed) → `DEGRADED` (multiple running manifests for one entity, latest terminal run `FAILED`/`PARTIAL`, or a resumable manifest with a stale or null worker heartbeat) → `STALE` (activity checkpoint and reconcile both older than the stale window, default 24h) → `READY`. A recent reconcile counts as activity, so reconcile-only operation with the incremental timer paused does not go stale.

Smoke checks after deploy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
curl -s -H "Authorization: Bearer $OPERATIONAL_STATUS_TOKEN" http://127.0.0.1:3000/api/ops/status
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ops/status  # expect 401
```

The durable sync worker writes `lastHeartbeatAt` on the active `SyncRun` every 30 seconds during discovery and item processing. `/api/ops/status` exposes `lastHeartbeatAt` and `heartbeatStale` per resumable manifest; a `RUNNING` manifest whose heartbeat is older than the 5-minute stale window (or that has no heartbeat) is reported `heartbeatStale: true` and classifies the endpoint `DEGRADED` before the 24-hour catalog-stale window fires. A fresh heartbeat is evidence the worker is alive; a stale or null heartbeat means the worker is likely dead or crashed — inspect scheduler and worker logs, then resume the manifest (`auto`/`resume` clears the stale heartbeat). A fresh heartbeat is evidence, not proof, of healthy progress. Ingress/TLS exposure of `/api/ops/status`, catalog seed, and scheduler enablement remain operator-controlled follow-up actions outside this repository.

## Rollback boundary

Application image rollback is allowed only after confirming schema compatibility. Additive migrations and indexes remain in the database during app rollback. Do not roll back a committed migration by deleting rows from `_prisma_migrations` or manually reversing SQL. Use a reviewed forward corrective migration after catalog inspection.

After either governance migration has been applied, do not roll back to an app image that does not filter public shares by `moderationStatus`; that can re-expose `HIDDEN` playlists. Roll forward to a moderation-aware image or use a reviewed compatibility release. If the first governance migration succeeded but the retention migration did not, keep traffic and Playlist/User deletion writes disabled until the second migration is repaired and verified.
If migration history and physical catalog state disagree, stop deployment, keep schedulers paused, preserve logs, and have the database operator reconcile state before resuming traffic.
