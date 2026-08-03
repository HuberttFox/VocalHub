# Production deployment runbook

This runbook covers deployment against an operator-managed PostgreSQL instance. It does not provision PostgreSQL, schedule jobs, or run production commands automatically.

## Preflight

1. Confirm release commit and build context, database target, maintenance window, and rollback owner. If using a registry, pin the same immutable image digest for `app`, `worker`, and `migrate`; otherwise run all commands from the checked-out release commit and do not rebuild from a dirty tree.
2. Pause VocaDB incremental, reconcile, artist refresh, and session-cleanup schedulers.
3. Wait for active worker containers to exit. Check `SyncRun` and `SyncItem` for `RUNNING` ambiguity before proceeding.
4. Verify a current PostgreSQL backup and a tested restore path. Confirm free disk space for additive indexes.
5. Confirm production secrets are separated by target: app receives `DATABASE_URL` and `AUTH_*`; worker receives `DATABASE_URL`, `VOCADB_*`, and `VOCADB_USER_AGENT`; maintenance receives only `DATABASE_URL`; migrate receives `DATABASE_URL` and optional `DIRECT_URL`.
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

Run migrations before starting app traffic, then seed catalog baseline. Seed is only for initial deployment or an operator-approved rebuild:

```bash
docker compose -f compose.production.yaml --profile migrate run --rm migrate
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml --profile worker run --rm worker seed
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

4. Check migration output and application startup logs. Keep scheduler paused until app health checks pass.
5. Deploy the new app image or container definition without changing database target.
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

External scheduler invokes one-shot containers. Prevent overlapping jobs at scheduler level; PostgreSQL advisory lock remains final worker protection:

```bash
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker auto incremental
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker auto reconcile
docker compose -f compose.production.yaml --profile worker run --rm --no-deps worker artists auto refresh
docker compose -f compose.production.yaml --profile maintenance run --rm --no-deps session-cleanup
# After governance migration is deployed:
docker compose -f compose.production.yaml --profile maintenance run --rm --no-deps playlist-report-cleanup
# Operator-only, explicit report queue/disposition:
node build/maintenance/governance/moderate-playlist.js list-reports --limit=50
node build/maintenance/governance/moderate-playlist.js resolve-report <report-uuid> <resolution-code>
node build/maintenance/governance/moderate-playlist.js dismiss-report <report-uuid> <resolution-code>
node build/maintenance/governance/moderate-playlist.js hide <playlist-uuid>

```

Recommended cadence: incremental every 15 minutes, reconcile daily during low traffic, artist refresh daily at a separate time, and session cleanup daily. Capture exit status and JSON output. Alert on nonzero exit, missing daily success, multiple `RUNNING` runs, or repeated `FAILED` items.

Playlist report cleanup removes only `RESOLVED`/`DISMISSED` reports older than 180 days. It must not remove `OPEN` reports. The moderation and triage commands are deployment-only and require operator shell/database access.



A worker receiving `SIGTERM` or `SIGINT` stops accepting new work and leaves resumable state. Keep at least 60 seconds termination grace period. `ACTIVITY_INTERVAL_SATURATED` requires a full seed rebuild, not repeated incremental retries.

## Rollback boundary

Application image rollback is allowed only after confirming schema compatibility. Additive migrations and indexes remain in the database during app rollback. Do not roll back a committed migration by deleting rows from `_prisma_migrations` or manually reversing SQL. Use a reviewed forward corrective migration after catalog inspection.

After either governance migration has been applied, do not roll back to an app image that does not filter public shares by `moderationStatus`; that can re-expose `HIDDEN` playlists. Roll forward to a moderation-aware image or use a reviewed compatibility release. If the first governance migration succeeded but the retention migration did not, keep traffic and Playlist/User deletion writes disabled until the second migration is repaired and verified.
If migration history and physical catalog state disagree, stop deployment, keep schedulers paused, preserve logs, and have the database operator reconcile state before resuming traffic.
