# Catalog query benchmark baseline

## Scope

This benchmark measures production `listSongs()`, `listArtistWorks()`, Artist/Tag list repositories, and aggregate `searchCatalog()` calls against deterministic synthetic PostgreSQL data. It does not call VocaDB. Candidate indexes use the `bench_catalog_` prefix and are created only in the disposable benchmark database; this follow-up promotes only the independently reviewed `SongTag(tagId, songId)` relation index to production.

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

`tag-relation` is promoted independently through migration `20260802090000_add_song_tag_tag_song_index`; alias GIN and popular-ordering candidates remain rejected or unpromoted pending separate evidence.

### Stage C target candidate comparisons

Target-scale candidate comparisons used 8 interleaved AB/BA state cycles, one warmup, and three measured calls per state block across all 36 scenarios for full-suite candidates. The targeted `tag-relation` comparison used the five Tag works scenarios. Every candidate preserved result digests and marker cardinalities. Captured candidate plans were replayed with `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE)`, and the runner restored baseline state and removed all `bench_catalog_%` indexes after each comparison.

| Candidate | Candidate plan use | Target paired result | Decision |
| --- | ---: | --- | --- |
| `tag-relation` | 36 candidate plan nodes in mixed suite; 15 candidate plan nodes in targeted Tag suite | Mixed full-suite Tag search medians improved 74.04–87.00%; corrected Tag works medians improved 10.35–86.66%, with 75–100% B wins and both order strata improving | Promote as independent production migration `20260802090000_add_song_tag_tag_song_index` |
| `artist-alias-gin` | 0 candidate plan nodes | Full-suite mean change approximately 0%; Artist exact-alias and no-hit paths were not stable | Reject |
| `artist-name-trigram` | 14 candidate plan nodes | Artist canonical/localized paths improved about 9–11%, but Song/aggregate paths mixed and several catalog paths regressed | Reject |
| `tag-alias-gin` | 14 candidate plan nodes | Aggregate searches improved 3.63–8.68% in selected cases, but alias and ordering strata were inconsistent | Reject |
| `tag-name-trigram` | 0 candidate plan nodes | No target candidate plan use; aggregate Tag-alias regressed 5.76% | Reject |
| `public-latest` | 0 candidate plan nodes | Latest first-page result did not improve; deep and Artist works paths regressed | Reject |
| `public-popular` | 0 candidate plan nodes | Popular ordering result did not improve consistently; Song/aggregate paths regressed | Reject |
| `credit-artist` regression | 36 candidate plan nodes | Existing reverse credit index remained used; duplicate-credit Artist works improved 61.38%, while unrelated paths were mixed | Existing production migration retained |

`tag-relation` passed its targeted Tag works gate and is promoted independently as migration `20260802090000_add_song_tag_tag_song_index`, creating `SongTag(tagId, songId)`. PostgreSQL used `Index Only Scan` on the candidate for all five scenarios, result digests matched, B won 75–100% of pairs, and both AB/BA strata improved. Production rollout remains subject to the documented backup, disk-space, scheduler pause, lock observation, and physical-catalog validation steps. This decision does not promote unrelated search candidates.


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

## Discovery baseline

Personalized `/discover` target-scale evidence now uses dataset version 5 with deterministic Favorite, owner-playlist, collaborator-playlist, overlap, and 500-seed-cap fixtures. This benchmark changes no production schema, index, or ranking algorithm. The 50k smoke used one warmup and two measured repetitions; full 3-warmup/15-repeat matrix remains required before production decisions.

| Scenario | Median | p95 | Queries | Result |
| --- | ---: | ---: | ---: | --- |
| `discover-popular-first-page` | 41.02 ms | 46.67 ms | 8 | deterministic |
| `discover-popular-deep-page` | 55.97 ms | 74.17 ms | 8 | deterministic |
| `discover-personalized-first-page` | 1033.97 ms | 1177.50 ms | 8 | deterministic |
| `discover-personalized-deep-page` | 1046.36 ms | 1160.71 ms | 8 | deterministic |

The 50k marker contained 50,000 songs, 2 viewers, 320 favorites, 2 playlists, 700 playlist songs, 1 collaborator, 1,000 raw viewer seeds, 695 valid deduplicated seeds before the repository cap, and 49,495 personalized candidates. The anonymous Discovery fallback remains the control. A full target smoke with 3 warmups and 15 measured repetitions produced the timings above; these are benchmark observations, not production SLO claims. Personalized SQL/EXPLAIN review remains before any production index or algorithm decision.


Search query decomposition adds no production index or migration. The bundled trigram and public-ordering candidates remain rejected. At the 50k target, `tag-relation` is promoted independently through migration `20260802090000_add_song_tag_tag_song_index`; reverse artist-credit index remains promoted through migration `20260727120000_add_song_artist_credit_artist_song_partial_index`. No unrelated candidate migration is included.

## Discovery SQL/EXPLAIN review

Target-scale SQL review for personalized `/discover` completed at the 50k dataset version 5 marker. It changes no production schema, index, repository SQL, or ranking algorithm. Raw reports remain local under ignored `.benchmark-results/`.

Commands (isolated `vocalhub_benchmark`, port 5434):

```bash
npm run benchmark:catalog -- run --warmups=3 --repeats=15 \
  --scenarios=discover-personalized-first-page,discover-personalized-deep-page,discover-popular-first-page,discover-popular-deep-page \
  --output=.benchmark-results/catalog-50000-discovery-baseline.json
npm run benchmark:catalog -- compare-discovery-shape --candidate=combined-cte \
  --warmups=3 --repeats=15 \
  --scenarios=discover-personalized-first-page,discover-personalized-deep-page \
  --output=.benchmark-results/catalog-50000-discovery-shape-combined-cte.json
npm run benchmark:catalog -- compare-discovery-shape --candidate=split-count \
  --warmups=3 --repeats=15 \
  --scenarios=discover-personalized-first-page,discover-personalized-deep-page \
  --output=.benchmark-results/catalog-50000-discovery-shape-split-count.json
```

### EXPLAIN baseline

Replayed personalized ranked statement (`EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE)`), root execution 1543 ms, planning 1.2 ms:

```
Limit | rows=24
  Function Scan | rows=500                      (CTE seeds)
  Sort | rows=24 | sort=top-N heapsort          (final page sort is bounded)
    WindowAgg | rows=49495                      (COUNT(*) OVER())
      Hash Join | rows=49495
        Hash Join | rows=49495
          Hash Join | rows=49495
            Seq Scan | rows=49995 | rel=Song
            Hash | rows=500                     (seeds)
          Hash | rows=50000
            Subquery Scan | rows=50000
              Aggregate | rows=50000 | group=["candidate.songId"]
                Sort | rows=1220766 | sort=external merge | space=50264KB
                  Nested Loop | rows=1220766
                    Nested Loop | rows=2232     (seeds x per-seed tags)
                    Index Only Scan | rows=547  | idx=SongTag_tagId_songId_idx
        Hash | rows=16805
          Subquery Scan | rows=16805
            Aggregate | rows=16805 | group=["candidate_1.songId"]
              Sort | rows=277662 | sort=external merge | space=11440KB
                Nested Loop | rows=277662       (artist self-join)
                  Index Scan  | idx=SongArtistCredit_songId_vocadbId_key
                  Index Only Scan | rows=292 | idx=SongArtistCredit_artistId_songId_idx
```

Findings:

- **Dominant cost is the `tag_scores` self-join fanout**: 500 seeds x ~4.5 tags x ~547 candidate songs per tag produce **1,220,766 intermediate rows**, grouped by `songId` via an `external merge` sort that spills to disk (`space=50264KB`). The `artist_scores` fanout (277,662 rows, 11 MB spill) is smaller. Together they dominate the 1.0–1.5 s runtime.
- **The window function is NOT the bottleneck.** The final `ORDER BY score DESC, id ASC LIMIT 24` already uses `top-N heapsort` (bounded); `WindowAgg` adds one pass over the 49,495 ranked rows.
- **All relevant production indexes are already selected** (`SongTag` PK, `SongTag_tagId_songId_idx`, `SongArtistCredit_songId_vocadbId_key`, partial `SongArtistCredit_artistId_songId_idx`). The seed query uses `Favorite`/`PlaylistSong`/`PlaylistCollaborator` keys. No missing index explains the cost.

### Candidate index

`I1 song-public-discovery` (partial `Song("id") WHERE NOT sourceDeleted AND lastSyncedAt IS NOT NULL AND syncStatus IN ('SYNCED','FAILED')`) was evaluated on the EXPLAIN baseline: the ranked query's `Song` access is join-driven (49,995 rows matching the visibility predicate, ~99.99% of the table), and the dominant node is the already-indexed `SongTag` self-join aggregation. A visibility partial index cannot remove the fanout cost, so the candidate matrix was not run. Decision: **reject**; document the EXPLAIN reasoning as the evidence.

### Candidate query shapes

Both candidates preserve byte-identical `DiscoveryDto` (mode, `DISCOVERY_ALGORITHM_VERSION`, pagination, ordered ids) — the harness enforces per-pair digest equality. Both were measured with 3 warmups and 15 measured AB/BA pairs at 50k.

| Shape | Scenario | A median | B median | Paired change | B win rate | Decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `combined-cte` (C2) | personalized-first-page | 1189.36 ms | 1249.92 ms | +7.30% | 0.27 | Reject |
| `combined-cte` (C2) | personalized-deep-page | 1162.32 ms | 1216.39 ms | +4.60% | 0.27 | Reject |
| `split-count` (C1) | personalized-first-page | 1259.88 ms | 2928.90 ms | +137.18% | 0.00 | Reject |
| `split-count` (C1) | personalized-deep-page | 1367.38 ms | 3094.37 ms | +120.66% | 0.00 | Reject |

- **`combined-cte`**: removing the window and computing the total via a scalar `COUNT(*)` over a `MATERIALIZED ranked` forces a materialized tuplestore pass plus a second sort for the page `ARRAY(...)` subquery — three passes over ranked instead of the single sorted pass, so it is ~5–7% slower at the target. (A 2-warmup/5-repeat smoke showed a spurious −5.87% B win; the full 15-repeat run reversed it — small samples are noise at this variance.)
- **`split-count`**: the always-run count recomputes the candidate join tree a second time, doubling the dominant `tag_scores` fanout — +120–137% slower. The existing deep-page fallback remains cheaper than an always-run count.

Neither shape passes the evidence gates (B win rate ≥ 75%, both order strata improving, no WindowAgg/temp regression), and neither addresses the real bottleneck.

### Decision

- **No query-shape change adopted.** Production `getDiscovery` keeps the window-count ranked query and its conditional deep-page fallback.
- **No index promoted.** All relation lookups are already indexed; the bottleneck is the algorithm-inherent tag-fanout aggregation (`tag_scores`/`artist_scores` self-joins), which materializes 1.22M intermediate rows with disk spill at 50k under the documented 4 MB `work_mem`.
- The benchmark harness (`compare-discovery-shape` command, `src/lib/discover/shape-query.ts` candidate shapes, digest-parity paired comparison) is retained for future evidence; the candidate shapes are marked rejected.
- Reducing the personalized runtime further requires an algorithm or data-model change (for example, precomputed tag/artist affinity or a bounded candidate set), which is out of scope and deferred. Current personalized medians at 50k remain in the ~1.16–1.32 s range (this session's runs; the M1 record of ~1.03 s reflects host variance).

## Bounded Candidate Discovery V2 evaluation

At 50k, 3 warmups and 15 adjacent AB/BA pairs compared V1 with V2. V2 passed deterministic shared-contract checks for the first page and reduced `candidate_ids` from 49,495 to 4,027, but deliberately changed candidate/ranking results and did not meet adoption gates. The initial deep-page measurement is invalid for comparison: V1's requested deep page lies beyond V2's bounded 168-page pool, so V2 returned an empty page; the comparator now rejects unequal page cardinality.

| Scenario | V1 median | V2 median | Paired change | V2 win rate | BA/AB strata |
| --- | ---: | ---: | ---: | ---: | --- |
| First page | 1485.59 ms | 593.93 ms | -63.90% | 0.53 | +333.99% / -76.04% |
| Deep page (invalid: V2 empty) | 1415.09 ms | 492.69 ms | -71.95% | 0.53 | +346.33% / -76.36% |

V2 still spills in the `tag_scores` external merge: 118,052 rows, 4,872 KB, with temp read/write blocks.

Decision: **reject production adoption**. V2 fails the no-spill gate and the both-strata and win-rate >=75% gates. Retain V1; keep V2 benchmark-only.
