# Catalog Benchmark Runner

The catalog benchmark measures production catalog repository paths against
deterministic synthetic data in a disposable PostgreSQL database. It never
calls VocaDB, and it never touches the development, integration-test, or
production databases.

## Safety requirements

- The runner requires `BENCHMARK_DATABASE_URL`. The database name must end in
  `_benchmark`.
- `BENCHMARK_DATABASE_URL` must identify a different database from
  `DATABASE_URL`, `DIRECT_URL`, and `TEST_DATABASE_URL`; the CLI rejects any
  alias.
- Reset-capable commands (`load`, `compare`, `matrix`) require an exact
  `--confirm-reset=<database-name>` confirmation. For the documented database
  that is exactly `--confirm-reset=vocalhub_benchmark`; a mismatch is rejected.
- Never point a destructive or reset command at a development, test, or
  production database.

## Safe start

The `benchmark` Compose profile provides a disposable PostgreSQL on host port
`5434` with database `vocalhub_benchmark`:

```bash
export BENCHMARK_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5434/vocalhub_benchmark
docker compose --profile benchmark up -d --wait postgres-benchmark
npm run benchmark:catalog -- setup --install-pg-trgm
npm run benchmark:catalog -- load --songs=5000 --seed=20260720 --confirm-reset=vocalhub_benchmark
npm run benchmark:catalog -- run --output=.benchmark-results/catalog-5000.json
```

- `setup` deploys the benchmark schema and, with `--install-pg-trgm`, creates
  the `pg_trgm` extension used by trigram candidates.
- `load` inserts a deterministic dataset of the requested song count.
- `run` measures the production repository paths against the loaded marker and
  writes the JSON report to `--output`.

Raw reports conventionally live under ignored `.benchmark-results/` so they do
not enter the normal diff or CI. Decision evidence is recorded separately in
the [catalog index baseline](../../docs/performance/catalog-index-baseline.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run benchmark:catalog -- setup [--install-pg-trgm]` | deploy benchmark schema; optionally install `pg_trgm` |
| `npm run benchmark:catalog -- load --songs=N [--seed=SEED] [--chunk-size=N] --confirm-reset=DB` | load deterministic dataset of `N` songs (default seed `20260720`) |
| `npm run benchmark:catalog -- run [--warmups=3] [--repeats=15] [--scenarios=ID,...] [--output=FILE]` | baseline run against the loaded marker |
| `npm run benchmark:catalog -- compare-search-shape [--warmups=3] [--repeats=15] [--scenarios=ID,...] [--output=FILE]` | paired comparison of broad search vs relation-branch `UNION` |
| `npm run benchmark:catalog -- compare-discovery-shape --candidate=combined-cte\|split-count [--warmups=3] [--repeats=15] [--scenarios=ID,...] [--output=FILE]` | paired comparison of production discovery vs a candidate query shape |
| `npm run benchmark:catalog -- compare-discovery-algorithm [--warmups=3] [--repeats=15] [--scenarios=ID,...] [--output=FILE]` | paired comparison of discovery V1 vs bounded-candidate V2 |
| `npm run benchmark:catalog -- compare --candidate=NAME --confirm-reset=DB [--cycles=8] [--block-repeats=3] [--warmups=1] [--scenarios=ID,...] [--output=FILE]` | interleaved baseline/candidate comparison for an index candidate |
| `npm run benchmark:catalog -- matrix --confirm-reset=DB [--sizes=5000,10000,20000,50000] [--candidate=NAME] [--scenarios=ID,...] [--output-dir=.benchmark-results]` | load each size, then run a baseline (or candidate) report per size |

`--help` lists the supported commands. This guide records their full supported
options. Defaults are `--warmups=3`, `--repeats=15`, `--cycles=8`,
`--block-repeats=3`, and matrix output directory `.benchmark-results`.

## Command notes

- `run`, `compare-search-shape`, `compare-discovery-shape`, and
  `compare-discovery-algorithm` require a dataset loaded by `load` (the marker)
  and refuse to run while `bench_catalog_*` indexes exist.
- `compare-discovery-shape --candidate=` accepts exactly `combined-cte` or
  `split-count`.
- `compare` installs and removes candidate `bench_catalog_*` indexes only inside
  the benchmark database, interleaves baseline/candidate state blocks, and
  fails if any paired result digest differs. Valid `--candidate` names are
  `credit-artist`, `tag-relation`, `tag-alias-gin`, `artist-alias-gin`,
  `artist-name-trigram`, `tag-name-trigram`, `public-latest`, `public-popular`,
  and `catalog-trigram`.
- `matrix` runs one dataset load and one report per size. The target matrix is
  exactly `5000,10000,20000,50000`; an explicit `--sizes` must still include
  every one of these sizes and must include the `50000` target. It writes
  `catalog-<size>-baseline.json` (or `catalog-<size>-compare-<candidate>.json`)
  under `--output-dir`.

## Reports and evidence

Reports printed to the terminal include per-scenario median/p95, query counts,
and determinism; with `--output=FILE` the same content is written as JSON.
Raw output is ignored and local-only. Performance decisions and production
index rollouts are recorded with measurements in the
[catalog index baseline](../../docs/performance/catalog-index-baseline.md);
benchmark results alone do not justify a production migration.
