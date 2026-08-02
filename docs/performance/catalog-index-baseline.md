# Catalog query benchmark baseline

## Scope

This benchmark measures production `listSongs()`, `listArtistWorks()`, Artist/Tag list repositories, and aggregate `searchCatalog()` calls against deterministic synthetic PostgreSQL data. It does not call VocaDB. Candidate indexes use the `bench_catalog_` prefix and are created only in the disposable benchmark database; this record does not add a production migration.

Raw JSON reports remain local under ignored `.benchmark-results/`.

## Environment

- Captured: 2026-07-22
- Dataset generator: version 4, seed `20260720`
- Scales: 5,000, 10,000, 20,000, and Stage C target 50,000 songs
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

## Stage C scope and initial evidence

Stage C target scale is 50,000 songs. Fixed 5k, 10k, and 20k controls remain required; 20k alone is not production-scale evidence. Dataset version 4 adds `ArtistName`, canonical/alias markers, and aggregate search scenarios. The runner calls local Song, Artist, Tag, and `searchCatalog()` repositories only; it does not import VocaDB modules or issue HTTP requests.

Initial 5k smoke baseline covered Artist canonical/localized/exact alias searches and aggregate no-hit, cross-group, and Tag alias searches. All results matched deterministic marker checksums. A two-cycle `artist-alias-gin` smoke comparison preserved result digests but showed unstable order-stratified timing (one B win, one A win) and no production recommendation.

The 50k target load completed with dataset version 4, seed `20260720`, and marker checksum `d66fe4635bc0c7a072353732300e075023fed89b9db5b4b29c7c8e1137e30632`. It contained 50,000 songs, 6,250 artists, 500 tags, 124,914 song names, 6,250 ArtistName rows, 100,206 credits, and 224,815 SongTag rows. The corrected standard target baseline used 3 warmups and 15 measured repetitions across all 36 scenarios, including high/medium/sparse Tag works and deep-page coverage; every scenario was deterministic and matched marker cardinalities. Corrected target median range was 8.87–360.15 ms. The aggregate Tag-alias baseline had a p95 of 518.98 ms, so p95 must be interpreted separately from median for that scenario. Tag works medians were 50.23–94.71 ms.

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

Interleaved 20k state blocks (8 AB/BA cycles, 1 warmup and 3 measured calls per block) removed the earlier A/A2 ambiguity. PostgreSQL used `bench_catalog_credit_artist_song` in candidate evidence plans, and every scenario improved:

| Scenario | A median | B median | Median paired improvement | B win rate |
| --- | ---: | ---: | ---: | ---: |
| High fan-out latest first | 33.30 ms | 25.48 ms | 29.40% | 100% |
| High fan-out latest deep | 32.89 ms | 23.93 ms | 28.36% | 100% |
| High fan-out popular first | 32.52 ms | 25.28 ms | 25.54% | 88% |
| Medium fan-out latest | 35.31 ms | 24.85 ms | 31.55% | 100% |
| Sparse latest | 14.13 ms | 7.91 ms | 46.53% | 100% |
| Duplicate-credit latest | 16.77 ms | 9.13 ms | 48.25% | 100% |

A second independent 20k invocation confirmed the result: 18.72–50.05% median paired improvement, 75–100% B wins, and both run-order strata improved for all scenarios.

Decision: **promoted to production** as migration `20260727120000_add_song_artist_credit_artist_song_partial_index`. Production creates `SongArtistCredit_artistId_songId_idx` on `(artistId, songId) WHERE artistId IS NOT NULL`. `prisma/schema.prisma` intentionally omits it because Prisma's ordinary `@@index` cannot represent the partial predicate. The integration suite verifies the physical catalog contract; deployment lock impact, failure recovery, and rollback are documented in README.

### `public-latest`

At 10k, median latest-page times improved 23–27%, but PostgreSQL did **not** use `bench_catalog_song_public_latest` in captured EXPLAIN plans. The timing change is therefore indistinguishable from cache/run-order effects.

Decision: **reject current candidate**. Do not add production index based on this run.

### Search trigram bundle

At 10k, PostgreSQL used only `bench_catalog_song_name_value_trgm` from the seven-index bundle in captured plans. Other trigram indexes were not selected for this broad Prisma `OR`. Median changes ranged from a 2.80% regression to a 14.31% improvement; A2 drift reached 8.58%, and common/rare title scenarios did not improve. The no-hit case improved 10.19%, but A2 was already 5.70% faster than A.

Decision: **reject bundled trigram migration**. Broad repository SQL still evaluates every relation branch, so seven indexes add write/storage cost without broad plan use or stable end-to-end gain. Evaluate query decomposition or a dedicated search document before reconsidering narrower trigram indexes.

### Tag relation, alias GIN, and popular ordering

Evidence collection remains pending or incomplete. No production recommendation yet.

### Stage C target candidate comparisons

Target-scale candidate comparisons used 8 interleaved AB/BA state cycles, one warmup, and three measured calls per state block across all 36 scenarios for full-suite candidates. The targeted `tag-relation` comparison used the five Tag works scenarios. Every candidate preserved result digests and marker cardinalities. Captured candidate plans were replayed with `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE)`, and the runner restored baseline state and removed all `bench_catalog_%` indexes after each comparison.

| Candidate | Candidate plan use | Target paired result | Decision |
| --- | ---: | --- | --- |
| `tag-relation` | 36 candidate plan nodes in mixed suite; 15 candidate plan nodes in targeted Tag suite | Mixed full-suite Tag search medians improved 74.04–87.00%; corrected Tag works medians improved 10.35–86.66%, with 75–100% B wins and both order strata improving | Passes Tag-only benchmark gate; production migration requires separate review |
| `artist-alias-gin` | 0 candidate plan nodes | Full-suite mean change approximately 0%; Artist exact-alias and no-hit paths were not stable | Reject |
| `artist-name-trigram` | 14 candidate plan nodes | Artist canonical/localized paths improved about 9–11%, but Song/aggregate paths mixed and several catalog paths regressed | Reject |
| `tag-alias-gin` | 14 candidate plan nodes | Aggregate searches improved 3.63–8.68% in selected cases, but alias and ordering strata were inconsistent | Reject |
| `tag-name-trigram` | 0 candidate plan nodes | No target candidate plan use; aggregate Tag-alias regressed 5.76% | Reject |
| `public-latest` | 0 candidate plan nodes | Latest first-page result did not improve; deep and Artist works paths regressed | Reject |
| `public-popular` | 0 candidate plan nodes | Popular ordering result did not improve consistently; Song/aggregate paths regressed | Reject |
| `credit-artist` regression | 36 candidate plan nodes | Existing reverse credit index remained used; duplicate-credit Artist works improved 61.38%, while unrelated paths were mixed | Existing production migration retained |

`tag-relation` passes the targeted Tag works benchmark gate: PostgreSQL used `Index Only Scan` on the candidate for all five scenarios, result digests matched, B won 75–100% of pairs, and both AB/BA strata improved. This evidence supports a separate production migration review for Tag reverse lookup, including index size, write amplification, deployment lock behavior, and physical-catalog validation. It does not justify bundling the index with unrelated search candidates. No migration is created in this benchmark change.


The follow-up benchmark replaces fixed run-order comparisons with adjacent `A→B` / `B→A` pairs. A is the original broad Prisma relation `OR`; B is a parameterized relation-branch `UNION` that returns exact total plus ordered page IDs and then hydrates the existing DTO inside one repeatable-read transaction. Every measured pair requires equal result digest and marker cardinality.

Commands:

```bash
npm run benchmark:catalog -- compare-search-shape \
  --warmups=3 --repeats=15 \
  --output=.benchmark-results/catalog-10000-search-shape.json
```

Completed evidence:

| Scale/run | A median range | B median range | Median paired improvement | B win rate |
| --- | ---: | ---: | ---: | ---: |
| 5k | 137.18–191.64 ms | 31.14–50.83 ms | 69.83–78.59% | 100% |
| 10k run 1 | 898.42–1,041.81 ms | 50.62–72.23 ms | 92.67–94.44% | 100% |
| 10k run 2 | 893.17–1,049.59 ms | 47.37–74.10 ms | 92.75–94.64% | 100% |
| 20k run 1 | 964.27–1,326.10 ms | 85.92–156.27 ms | 88.09–91.03% | 100% |
| 20k run 2 | 971.74–1,118.20 ms | 93.98–127.31 ms | 88.20–90.26% | 100% |

All 11 scenarios—including rare/common/no-hit, every relation branch, common deep page, and popular sort—produced identical IDs, query metadata, and pagination. `B first` and `B second` strata point in the same direction. At 10k, candidate EXPLAIN used independent branch plans without temp read/write blocks; representative root SQL execution fell from roughly 448–559 ms per broad count/page statement to about 55 ms for the combined match/count/page statement.

Both independent 20k invocations also cleared every gate: 88–91% median paired improvement, 100% B wins, consistent order strata, no semantic mismatch, and no candidate EXPLAIN temp read/write blocks. Across both 10k and both 20k runs, candidate p95 improved by at least 85.73%; no representative branch regressed.

Decision: **adopt relation-branch `UNION` for searched repository requests**. Keep unsearched catalog requests on their existing Prisma path. Retain broad search only as a benchmark parity control. This changes query execution, not search semantics or database schema.

## Current decision

Search query decomposition adds no production index or migration. The bundled trigram and public-ordering candidates remain rejected. At the 50k target, `tag-relation` passes only its targeted Tag works gate and remains pending separate production migration review. Reverse artist-credit index remains the only promoted production index through migration `20260727120000_add_song_artist_credit_artist_song_partial_index`; no production migration is created by this Stage C benchmark change.
