# Discovery Snapshot Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make discovery snapshot reads safely verifiable and operationally observable, while retaining an explicit, default-off, immediately reversible app read flag.

**Architecture:** Keep live V1 and snapshot selection inside `getDiscovery`; add an injected selection option so parity tests never mutate process-global environment during concurrent tests. Extend the existing operator-only `/api/ops/status` discovery summary with aggregate rollout coverage, then turn the runbook's prose gate into a repeatable operator checklist. Snapshot materialization, schema, Compose topology, timer cadence, and production flag value remain unchanged.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, PostgreSQL, Vitest, Docker Compose, systemd.

**Spec:** No standalone specification. Source requirements are the committed snapshot implementation plus `docs/production-deployment-runbook.md` preflight and rollout gates: keep `DISCOVERY_SNAPSHOT_READS_ENABLED=false` until migration, backfill, parity, and freshness checks finish; enable only after those checks pass.

## Global Constraints

- Begin implementation from current `master` in a fresh isolated worktree; do not build on `feat/discovery-snapshots`.
- Keep `DISCOVERY_SNAPSHOT_READS_ENABLED` defaulting to `false`; do not activate snapshot reads, deploy, migrate production, seed, invoke VocaDB, or modify external systems.
- VocaDB remains reachable only through `worker/sync-vocadb.ts` and `src/lib/vocadb/`; discovery HTTP/UI paths remain PostgreSQL-only.
- Treat FRESH snapshot comparisons as parity scope. STALE snapshots are deliberately authoritative while reads are enabled and must not be forced to match live V1.
- Keep user IDs, playlist IDs, song IDs, snapshot IDs, and error messages out of `/api/ops/status` aggregate discovery output.
- Preserve existing operations classification and HTTP status behavior: discovery backlog alone must not change `READY`/`DEGRADED`/`STALE` classification; `failedProfileCount > 0` remains the discovery degradation trigger.
- Do not add schema migrations, generated Prisma changes, new deployment services, new environment variables, percentage rollouts, or automatic flag flips.
- Do not perform destructive database work outside isolated `vocalhub_test` or `vocalhub_benchmark` targets.
- Use explicit environment injection in tests; restore any deliberately changed `process.env` value in `afterEach`.

---

## File Structure

- `src/lib/discover/repository.ts`: owns live-versus-snapshot read selection; gains a testable optional read-selection override without changing default production behavior.
- `tests/integration/discover-repository.test.ts`: owns database-backed behavior for discovery ranking, freshness, materialization, and the app read gate.
- `src/lib/operations/status-dto.ts`: owns public aggregate shape returned by the operations endpoint.
- `src/lib/operations/status-repository.ts`: calculates non-sensitive snapshot rollout aggregates in the same repeatable-read transaction as existing status data.
- `tests/integration/operations-status-repository.test.ts`: verifies aggregate counts, privacy, and unchanged classification behavior.
- `tests/unit/production-compose-contract.test.ts`: protects app-only flag interpolation and jobs Compose isolation.
- `docs/production-deployment-runbook.md`: remains canonical operator procedure; gains bounded staging/enabling/rollback steps rather than a second deployment guide.

## Task 1: Make snapshot selection explicit and lock default-off behavior

**Files:**
- Modify: `src/lib/discover/repository.ts:76-121`
- Modify: `tests/integration/discover-repository.test.ts:17-41,270-344`

**Interfaces:**
- Consumes: `getSnapshotDiscovery(tx, viewerId, query)` and current `DiscoveryDto` construction.
- Produces: `DiscoveryReadOptions` and `getDiscovery(viewerId, query, database?, options?)` for deterministic integration parity callers.

- [x] **Step 1: Write failing integration coverage for flag precedence**

Add a test that constructs one viewer, a current READY snapshot whose item is distinct from live results, and asserts all three selection states:

```ts
const live = await getDiscovery(viewer.id, { page: 1, pageSize: 24 }, db, {
  snapshotReadsEnabled: false,
});
const snapshot = await getDiscovery(viewer.id, { page: 1, pageSize: 24 }, db, {
  snapshotReadsEnabled: true,
});

expect(live).toMatchObject({ freshness: "FRESH", mode: "POPULAR" });
expect(live.items.map((item) => item.id)).not.toContain(snapshotOnly.id);
expect(snapshot).toMatchObject({ freshness: "STALE", mode: "PERSONALIZED" });
expect(snapshot.items.map((item) => item.id)).toEqual([snapshotOnly.id]);
```

Use a stale-but-READY snapshot so the two paths cannot accidentally produce the same ranking. Also call `getDiscovery` with no fourth argument while `DISCOVERY_SNAPSHOT_READS_ENABLED` is unset and assert it matches the `snapshotReadsEnabled: false` response.

- [x] **Step 2: Run the targeted test and confirm current API cannot express override**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npx vitest run tests/integration/discover-repository.test.ts -t "defaults snapshot reads off"
```

Expected: TypeScript or runtime failure because `getDiscovery` has no explicit read option.

- [x] **Step 3: Add a narrow read-selection option**

In `repository.ts`, define and use:

```ts
export type DiscoveryReadOptions = {
  snapshotReadsEnabled?: boolean;
};

export async function getDiscovery(
  viewerId: string | null,
  query: DiscoveryQuery,
  database: DiscoveryDb = getDb(),
  options: DiscoveryReadOptions = {},
): Promise<DiscoveryDto> {
  return database.$transaction(async (tx) => {
    const snapshotReadsEnabled = options.snapshotReadsEnabled
      ?? process.env.DISCOVERY_SNAPSHOT_READS_ENABLED === "true";
```

Leave all following branch logic intact. Do not centralize or validate the environment variable in this task: existing production behavior treats any value other than exact `"true"` as disabled, and this plan must preserve it.

- [x] **Step 4: Pass test and run adjacent discovery coverage**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npx vitest run tests/integration/discover-repository.test.ts
```

Expected: all discovery repository integration tests pass, including current environment-backed snapshot tests and new option-backed gate test.

- [x] **Step 5: Commit task boundary**

```bash
git add src/lib/discover/repository.ts tests/integration/discover-repository.test.ts
git commit -m "test(discovery): lock snapshot read gate"
```

## Task 2: Add executable fresh snapshot parity and freshness-state gates

**Files:**
- Modify: `tests/integration/discover-repository.test.ts:43-56,489-517,711-747`

**Interfaces:**
- Consumes: `getDiscovery(..., { snapshotReadsEnabled })` from Task 1, `materializeDiscoverySnapshots(limit, db)`, `setFavorite`, and `invalidateDiscoveryCatalog`.
- Produces: CI-backed DTO equality evidence required before an operator enables reads.

- [x] **Step 1: Add reusable stable discovery digest helper**

Near test helpers, define a local projection that covers every observable response field, not only IDs:

```ts
function discoveryDigest(result: Awaited<ReturnType<typeof getDiscovery>>) {
  return {
    items: result.items.map((item) => item.id),
    mode: result.mode,
    algorithmVersion: result.algorithmVersion,
    freshness: result.freshness,
    pagination: result.pagination,
  };
}
```

This is intentionally test-local. Do not import benchmark-only checksum code into application integration tests.

- [x] **Step 2: Write failing materialize-then-compare tests**

Create deterministic fixtures with one seed and at least 26 ranked candidates so `page: 1, pageSize: 24` and `page: 2, pageSize: 24` exercise first and deep pages. Materialize once, then compare live and fresh snapshot responses without writes between reads:

```ts
for (const query of [
  { page: 1, pageSize: 24 },
  { page: 2, pageSize: 24 },
]) {
  const live = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: false });
  const snapshot = await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true });
  expect(discoveryDigest(snapshot)).toEqual(discoveryDigest(live));
  expect(snapshot.freshness).toBe("FRESH");
}
```

Add two edge fixtures in the same test file:

```ts
// Seed exists but has no matching candidates: materialized zero-item snapshot and live path both use POPULAR.
expect(discoveryDigest(snapshotZero)).toEqual(discoveryDigest(liveZero));

// Anonymous visitor never has a profile: read selection leaves public POPULAR result unchanged.
expect(discoveryDigest(anonymousSnapshot)).toEqual(discoveryDigest(anonymousLive));
```

Do not assert stale snapshot equality. Use no `process.env` mutation in these new parity cases.

- [x] **Step 3: Run only parity cases and confirm initial failure**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npx vitest run tests/integration/discover-repository.test.ts -t "parity"
```

Expected before helper/fixtures settle: failure that identifies any ranking, total, page, mode, algorithm-version, or freshness mismatch.

- [x] **Step 4: Add one lifecycle state-machine test**

Use real invalidation and rebuild operations, asserting intended non-parity states rather than conflating them with parity:

```ts
expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("FRESH");
await setFavorite(viewer.id, addedSeed.id, true);
expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("STALE");
await materializeDiscoverySnapshots(1, db);
expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("FRESH");
await db.$transaction((tx) => invalidateDiscoveryCatalog(tx));
expect((await getDiscovery(viewer.id, query, db, { snapshotReadsEnabled: true })).freshness).toBe("STALE");
```

Then use a separate viewer with favorite seed and no usable current snapshot to assert `PENDING` plus popular fallback. Do not delete a profile as a synthetic transition; no-profile users are real, but direct deletion does not model normal application behavior.

- [x] **Step 5: Pass all discovery integration tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- --runInBand
```

If Vitest does not accept `--runInBand`, rerun the repository’s normal integration command:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test npm run test:integration
```

Expected: full integration suite passes. If a snapshot/live difference appears, fix ranking materialization or repository selection behavior; do not weaken digest fields or exclude deep-page parity.

- [x] **Step 6: Commit task boundary**

```bash
git add tests/integration/discover-repository.test.ts
git commit -m "test(discovery): gate fresh snapshot parity"
```

## Task 3: Expose non-sensitive rollout coverage in operations status

**Files:**
- Modify: `src/lib/operations/status-dto.ts:24-28`
- Modify: `src/lib/operations/status-repository.ts:87-176,201-222`
- Modify: `tests/integration/operations-status-repository.test.ts:80-324`

**Interfaces:**
- Consumes: `DISCOVERY_CATALOG_STATE_ID`, `staleDiscoveryCandidatesQuery(expiredLeaseAt)`, snapshot/profile version semantics from `getSnapshotDiscovery`, and existing status classification policy.
- Produces: `OperationsDiscoveryStatusDto` with aggregate rollout fields, no identity-bearing data.

- [x] **Step 1: Write failing DTO-level integration assertions**

Extend fixtures to assert exactly these fields:

```ts
expect(status.discovery).toEqual({
  snapshotReadsEnabled: false,
  catalogVersion: 1,
  freshProfileCount: 1,
  staleProfileCount: 1,
  unprovisionedCandidateCount: 1,
  activeBuildCount: 1,
  failedProfileCount: 0,
  oldestPendingAt: expectedPendingAt.toISOString(),
});
```

Create aggregate-only records for each state:

- one profile whose current READY snapshot matches library and required/current catalog versions;
- one stale profile with a non-current version;
- one favorite or non-empty playlist candidate with no profile;
- one stale profile whose `refreshStartedAt` is newer than lease expiry, representing active materialization;
- one profile with `lastRefreshError`.

Assert `JSON.stringify(status)` contains none of their user IDs, snapshot IDs, song IDs, playlist IDs, or error text. Retain assertions that `failedProfileCount > 0` is `DEGRADED`, while stale/backlog counts without error leave a healthy catalog `READY`.

- [x] **Step 2: Run targeted status test and confirm missing fields**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npx vitest run tests/integration/operations-status-repository.test.ts -t "rollout coverage"
```

Expected: failure because current DTO exposes only `staleProfileCount`, `failedProfileCount`, and `oldestPendingAt`.

- [x] **Step 3: Define stable aggregate DTO names**

Replace `OperationsDiscoveryStatusDto` with:

```ts
export type OperationsDiscoveryStatusDto = {
  snapshotReadsEnabled: boolean;
  catalogVersion: number;
  freshProfileCount: number;
  staleProfileCount: number;
  unprovisionedCandidateCount: number;
  activeBuildCount: number;
  failedProfileCount: number;
  oldestPendingAt: string | null;
};
```

`snapshotReadsEnabled` must use exact current application semantics (`process.env.DISCOVERY_SNAPSHOT_READS_ENABLED === "true"`). Read it once at `getOperationsStatus` entry and pass it into `discoveryStatus`; do not make maintenance services depend on it.

- [x] **Step 4: Extend existing aggregate query without leaking identities**

Keep the existing `staleDiscoveryCandidatesQuery(expiredLeaseAt)` CTE and return all counts in its existing `$queryRaw` call. Add a CTE that joins each `DiscoveryProfile` to its `currentSnapshot` and catalog state, then compute:

```sql
fresh_profiles AS (
  SELECT profile."userId"
  FROM "DiscoveryProfile" profile
  JOIN "DiscoverySnapshot" snapshot ON snapshot.id = profile."currentSnapshotId"
  LEFT JOIN "DiscoveryCatalogState" catalog ON catalog.id = 'catalog'
  WHERE snapshot.status = 'READY'
    AND snapshot."libraryVersion" = profile."libraryVersion"
    AND snapshot."catalogVersion" >= GREATEST(
      profile."requiredCatalogVersion", COALESCE(catalog.version, 0)
    )
)
```

Return only scalar aggregates:

```sql
(SELECT COUNT(*)::int FROM fresh_profiles) AS "freshProfileCount",
(SELECT COUNT(*)::int FROM stale_candidates WHERE "profileUpdatedAt" IS NULL) AS "unprovisionedCandidateCount",
(SELECT COUNT(*)::int FROM "DiscoveryProfile"
 WHERE "refreshStartedAt" IS NOT NULL AND "refreshStartedAt" >= ${expiredLeaseAt}) AS "activeBuildCount",
(SELECT COALESCE(MAX(version), 0)::int FROM "DiscoveryCatalogState"
 WHERE id = ${DISCOVERY_CATALOG_STATE_ID}) AS "catalogVersion"
```

Do not change `staleProfileCount` semantics: it continues to count immediately claimable stale candidates and excludes active leases. `activeBuildCount` is separate so operators can distinguish work in flight from backlog.

- [x] **Step 5: Pass status, route, and policy tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npx vitest run tests/integration/operations-status-repository.test.ts tests/unit/operational-routes.test.ts tests/unit/operations-status-policy.test.ts
```

Expected: aggregate values match fixtures, JSON remains private, and existing classification/503 behavior remains unchanged.

- [x] **Step 6: Commit task boundary**

```bash
git add src/lib/operations/status-dto.ts src/lib/operations/status-repository.ts tests/integration/operations-status-repository.test.ts
git commit -m "feat(ops): expose snapshot rollout coverage"
```

## Task 4: Make rollout and rollback procedure executable in contracts and docs

**Files:**
- Modify: `tests/unit/production-compose-contract.test.ts:1-40`
- Modify: `tests/unit/systemd-scheduler-contract.test.ts:1-60`
- Modify: `docs/production-deployment-runbook.md:13,95-120,138-146`

**Interfaces:**
- Consumes: app-only Compose interpolation, jobs-only environment isolation, materializer JSON batch result, and Task 3 `discovery` aggregate fields.
- Produces: stable deployment contracts plus a canonical manual staging rollout and immediate read rollback procedure.

- [x] **Step 1: Write failing deployment-contract assertions**

In the app Compose test, assert app uses exact pass-through/default interpolation:

```ts
expect(appService.environment.DISCOVERY_SNAPSHOT_READS_ENABLED)
  .toBe("${DISCOVERY_SNAPSHOT_READS_ENABLED:-false}");
```

In jobs Compose/systemd tests, assert maintenance services and `deploy/systemd/vocalhub.env.example` do not contain `DISCOVERY_SNAPSHOT_READS_ENABLED` or any `AUTH_` variable. This locks intentional separation: app controls reads; jobs build/prune snapshots independently.

- [x] **Step 2: Run targeted contracts and confirm expected baseline**

Run:

```bash
npx vitest run tests/unit/production-compose-contract.test.ts tests/unit/systemd-scheduler-contract.test.ts
```

Expected: existing default-off assertion passes; newly added absence/pass-through assertions identify any test helper mismatch before documentation changes.

- [x] **Step 3: Add an operator checklist under discovery materialization**

In the existing scheduler/discovery block, retain all commands and append concise ordered procedure:

```markdown
1. Deploy additive discovery migrations with reads still `false`.
2. Run `discovery-materializer --limit=100` repeatedly. Capture each JSON batch result.
3. Query authenticated `/api/ops/status`. Before enabling, require `staleProfileCount === 0`, `activeBuildCount === 0`, `failedProfileCount === 0`, and `oldestPendingAt === null`; review `freshProfileCount`, `unprovisionedCandidateCount`, and `catalogVersion` as coverage evidence.
4. Run fresh snapshot parity integration coverage against an isolated test database and staging fixtures. Check first and deep pages plus popular fallback; do not treat stale snapshots as parity failures.
5. In staging app deployment environment only, set `DISCOVERY_SNAPSHOT_READS_ENABLED=true` and redeploy `app`. Jobs environment and timers remain unchanged.
6. Monitor JSON materializer results and `/api/ops/status`; promote production only after staging remains fresh and error-free for operator-defined observation window.
7. Roll back reads immediately by setting `DISCOVERY_SNAPSHOT_READS_ENABLED=false` and redeploying only `app`. Keep tables, materializer, cleanup, and migrations in place; no schema rollback is needed.
```

Also state exact batch success rule: continue after `LIMIT_REACHED`; accept `QUEUE_DRAINED` only with `failedCount === 0` and `deferredCount === 0`; investigate any nonzero failure before enabling. State `BUDGET_EXHAUSTED` needs subsequent batches and cannot satisfy queue drain alone.

Do not add automated production commands, a staging Compose file, a percentage rollout, secrets, or an enabling command that could be copied without the gate.

- [x] **Step 4: Pass contract tests and documentation invariants**

Run:

```bash
npx vitest run tests/unit/production-compose-contract.test.ts tests/unit/systemd-scheduler-contract.test.ts
rg -n 'DISCOVERY_SNAPSHOT_READS_ENABLED=false|DISCOVERY_SNAPSHOT_READS_ENABLED=true|staleProfileCount|freshProfileCount|activeBuildCount|unprovisionedCandidateCount|oldestPendingAt|failedCount|deferredCount|QUEUE_DRAINED|BUDGET_EXHAUSTED' docs/production-deployment-runbook.md
```

Expected: contracts pass and every rollout gate/rollback condition appears in canonical runbook.

- [x] **Step 5: Commit task boundary**

```bash
git add tests/unit/production-compose-contract.test.ts tests/unit/systemd-scheduler-contract.test.ts docs/production-deployment-runbook.md
git commit -m "docs(ops): define snapshot rollout gate"
```

## Task 5: Run release-quality gates and capture local rollout evidence

**Files:**
- Modify: none expected.
- Verify: all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: completed parity tests, status contracts, deployment contracts, and runbook.
- Produces: reproducible evidence required for code review and later staging execution; no production side effects.

- [x] **Step 1: Prepare only isolated integration database**

Run:

```bash
docker compose --profile test up -d --wait postgres-test
DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
DIRECT_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
npm run db:deploy
```

Expected: only `vocalhub_test` is migrated. Stop if connection host or database name differs from the isolated target.

- [x] **Step 2: Run focused regression suites**

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
npx vitest run tests/integration/discover-repository.test.ts tests/integration/operations-status-repository.test.ts
npx vitest run tests/unit/production-compose-contract.test.ts tests/unit/systemd-scheduler-contract.test.ts tests/unit/operational-routes.test.ts tests/unit/operations-status-policy.test.ts
```

Expected: all focused snapshot, operations, and deployment-contract suites pass.

- [x] **Step 3: Run static quality gates**

Run:

```bash
npx tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/discover/repository.ts src/lib/operations/status-dto.ts src/lib/operations/status-repository.ts tests/integration/discover-repository.test.ts tests/integration/operations-status-repository.test.ts tests/unit/production-compose-contract.test.ts tests/unit/systemd-scheduler-contract.test.ts
npm run build
git diff --check
git status --short
```

Expected: typecheck, scoped lint, build, and whitespace check pass. Report unrelated pre-existing worktree changes separately; do not alter them.

- [ ] **Step 4: Verify runtime API surface against isolated database**

Start the app with `DISCOVERY_SNAPSHOT_READS_ENABLED=false`, a generated non-placeholder `OPERATIONAL_STATUS_TOKEN`, and isolated `vocalhub_test` connection variables. Seed only test fixtures through existing tests or local database fixtures; never contact VocaDB. Request:

```bash
curl -s -H "Authorization: Bearer $OPERATIONAL_STATUS_TOKEN" http://127.0.0.1:<port>/api/ops/status
```

Expected: response includes aggregate `discovery.snapshotReadsEnabled: false`, scalar coverage fields, and no fixture IDs or error text. Restart app with `DISCOVERY_SNAPSHOT_READS_ENABLED=true` only against the same isolated database and confirm `snapshotReadsEnabled: true`; then stop it. This proves environment pass-through, endpoint serialization, and rollback selection without a deployment.

- [ ] **Step 5: Request whole-branch review and record rollout limits**

Request review of complete branch diff. Confirm review specifically covers:

- exact default-off fallback when a READY snapshot exists;
- fresh first/deep-page parity including pagination metadata;
- stale behavior intentionally excluded from equality;
- active-build versus immediately-claimable backlog semantics;
- aggregate status privacy;
- app-only flag wiring and jobs-only isolation;
- no change that auto-enables reads or alters schema/migrations.

Record residual operator limits: rollout is environment-level, not percentage/user-level; staging observation window remains an operator-owned decision; current snapshots may intentionally serve stale results while enabled.

- [x] **Step 6: Commit final verification only if artifacts changed**

If verification added no tracked artifact, do not create an empty commit. Otherwise:

```bash
git add <verification-artifacts>
git commit -m "test(discovery): verify snapshot rollout"
```

## Final Acceptance Criteria

- `getDiscovery` defaults to exact current environment behavior, but tests can select live or snapshot reads without global environment mutation.
- A READY snapshot is demonstrably ignored when reads are false/unset, even if it would return different results.
- Fresh materialized snapshot and live V1 responses match in item order, mode, algorithm version, freshness, and pagination for first/deep pages, zero-candidate popular fallback, and anonymous popular reads.
- Fresh, stale-after-library-change, rematerialized-fresh, stale-after-catalog-change, and pending-no-usable-snapshot states are tested as distinct intended behaviors.
- `/api/ops/status` reports only scalar discovery rollout fields: `snapshotReadsEnabled`, `catalogVersion`, `freshProfileCount`, `staleProfileCount`, `unprovisionedCandidateCount`, `activeBuildCount`, `failedProfileCount`, and `oldestPendingAt`.
- Existing operations classification and endpoint behavior remain unchanged except for additive response fields.
- Deployment tests prove app can override the default-off flag and jobs/systemd remain isolated from it and `AUTH_*`.
- Canonical runbook specifies repeated backfill, zero-backlog checks, fresh-only parity, staging-only app enablement, monitoring, and app-only rollback to `false`.
- No schema/migration, timer, Compose service topology, automatic rollout, production action, VocaDB call, or destructive non-isolated database action occurs.
