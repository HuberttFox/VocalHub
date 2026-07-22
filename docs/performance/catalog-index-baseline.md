# Catalog query benchmark baseline

## Scope

This benchmark measures production `listSongs()` and `listArtistWorks()` repository calls against deterministic synthetic PostgreSQL data. It does not call VocaDB. Candidate indexes use the `bench_catalog_` prefix and are created only in the disposable benchmark database; this record does not add a production migration.

Raw JSON reports remain local under ignored `.benchmark-results/`.

## Environment

- Captured: 2026-07-22
- Dataset generator: version 3, seed `20260720`
- Scales: 5,000, 10,000, and 20,000 songs
- Measurement: 3 warmups, 15 measured repetitions, median and p95 wall time
- Runtime: Node.js 26.5.0, PostgreSQL 17.10 in Docker on WSL2
- Host: AMD Ryzen 7 5800H, 16 logical CPUs, 15 GiB RAM
- PostgreSQL: `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=4GB`, `random_page_cost=4`, `max_parallel_workers_per_gather=2`
- SQL evidence: Prisma query events replayed with `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE)`

Commands:

```bash
npm run benchmark:catalog -- setup --install-pg-trgm
npm run benchmark:catalog -- load --songs=10000 --seed=20260720 \
  --chunk-size=100 --confirm-reset=vocalhub_benchmark
npm run benchmark:catalog -- run --warmups=3 --repeats=15 \
  --output=.benchmark-results/catalog-10000-baseline.json
```

## Baseline

All repeated results were deterministic and matched dataset marker cardinalities.

| Scenario group | 5k median range | 10k median range | 20k median range | Main plan evidence |
| --- | ---: | ---: | ---: | --- |
| Latest/popular catalog pages | 15.60–19.05 ms | 43.78–48.73 ms | 33.44–57.04 ms | Song scan plus explicit sort; existing relationship indexes serve result hydration |
| Search scenarios | 135.29–196.83 ms | 929.46–1,033.49 ms | 1,083.83–1,429.40 ms | Sequential scans across Song, SongName, SongArtistCredit, Artist, SongTag, and Tag |
| Artist works | 10.64–24.37 ms | 11.02–28.89 ms | 17.79–44.49 ms | Reverse `artistId` lookup scans SongArtistCredit; sparse cases then probe Song by PK |

Search growth is the dominant issue. Every search uses one broad Prisma `OR`, so each branch remains part of the generated SQL even when the marker matches only one source.

## Candidate evidence

### `credit-artist`

Candidate:

```sql
CREATE INDEX bench_catalog_credit_artist_song
ON "SongArtistCredit" ("artistId", "songId")
WHERE "artistId" IS NOT NULL;
```

At 10k, PostgreSQL used this index in every measured artist-work scenario. Median changes versus baseline A:

| Scenario | A | Candidate B | A2 | B vs A |
| --- | ---: | ---: | ---: | ---: |
| High fan-out latest first | 27.10 ms | 19.16 ms | 30.20 ms | -29.31% |
| High fan-out latest deep | 25.95 ms | 16.40 ms | 29.22 ms | -36.83% |
| Medium fan-out latest | 23.30 ms | 16.12 ms | 23.87 ms | -30.83% |
| Sparse latest | 9.66 ms | 7.29 ms | 10.64 ms | -24.54% |
| Duplicate-credit latest | 12.63 ms | 7.83 ms | 11.69 ms | -38.00% |

High fan-out popular showed -38.65%, but A2 drifted +47.37%; treat that single figure as noisy. Remaining scenarios improved beyond their A/A2 drift. Candidate was removed after comparison, and no `bench_catalog_%` indexes remained.

At 20k, PostgreSQL again used the candidate in every artist-work plan, but run-order drift was much larger. Medium/sparse/duplicate medians improved 8–19%, high latest first improved only 2%, high popular regressed 16%, and A2 drift ranged from -15% to +91%. This does not independently confirm a stable end-to-end gain.

Decision: **defer production migration**. Planner-use evidence is strong at both scales, but timing evidence conflicts at 20k. Repeat under a less noisy environment or use interleaved A/B execution before production DDL.

### `public-latest`

At 10k, median latest-page times improved 23–27%, but PostgreSQL did **not** use `bench_catalog_song_public_latest` in captured EXPLAIN plans. The timing change is therefore indistinguishable from cache/run-order effects.

Decision: **reject current candidate**. Do not add production index based on this run.

### Search trigram bundle

At 10k, PostgreSQL used only `bench_catalog_song_name_value_trgm` from the seven-index bundle in captured plans. Other trigram indexes were not selected for this broad Prisma `OR`. Median changes ranged from a 2.80% regression to a 14.31% improvement; A2 drift reached 8.58%, and common/rare title scenarios did not improve. The no-hit case improved 10.19%, but A2 was already 5.70% faster than A.

Decision: **reject bundled trigram migration**. Broad repository SQL still evaluates every relation branch, so seven indexes add write/storage cost without broad plan use or stable end-to-end gain. Evaluate query decomposition or a dedicated search document before reconsidering narrower trigram indexes.

### Tag relation, alias GIN, and popular ordering

Evidence collection remains pending or incomplete. No production recommendation yet.

## Current decision

Do not change `prisma/schema.prisma` or add a migration in this benchmark branch. Search has strongest scaling problem, but bundled trigram indexes do not fix broad `OR` query cost. Reverse artist-credit index is consistently selected by PostgreSQL, yet 20k timing variance prevents accepting it. Public latest index was not selected. Next step: reduce benchmark noise/interleave candidates and redesign search query shape before production DDL.