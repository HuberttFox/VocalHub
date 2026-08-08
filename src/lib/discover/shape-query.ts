import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { DiscoveryQuery } from "@/lib/discover/query";
import type { DiscoveryDto } from "@/lib/discover/dto";
import {
  runDiscoveryTransaction,
  type DiscoveryDb,
  type RankedResult,
} from "@/lib/discover/repository";

/**
 * Benchmark candidate query shapes for personalized discovery.
 *
 * The current production query computes the total via `COUNT(*) OVER()` in the
 * ranked statement, which forces PostgreSQL to fully sort every candidate row
 * before OFFSET/LIMIT. These candidates remove the window function so the page
 * selection can use a bounded top-N sort, moving the total to a separate
 * count-only path. Result semantics (seed collection, score formula, ordering,
 * pagination, mode, algorithmVersion) are byte-identical to `getDiscovery`.
 *
 * The CTE fragments below are textually identical to `getPersonalizedIds` in
 * repository.ts; the benchmark digest-parity gate rejects any drift.
 */

const TAG_SCORES_CTE = `
tag_scores AS (
  SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."tagId")::int AS shared_tags
  FROM "SongTag" candidate
  JOIN "SongTag" seed ON seed."tagId" = candidate."tagId"
  JOIN seeds ON seeds.id = seed."songId"
  GROUP BY candidate."songId"
),`;

const ARTIST_SCORES_CTE = `
artist_scores AS (
  SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."artistId")::int AS shared_artists
  FROM "SongArtistCredit" candidate
  JOIN "SongArtistCredit" seed ON seed."artistId" = candidate."artistId"
  JOIN seeds ON seeds.id = seed."songId"
  WHERE candidate."artistId" IS NOT NULL
    AND seed."artistId" IS NOT NULL
  GROUP BY candidate."songId"
),`;

function rankedCte(materialize: boolean): string {
  return `
ranked AS${materialize ? " MATERIALIZED" : ""} (
  SELECT s.id,
    (COALESCE(t.shared_tags, 0) * 100 + COALESCE(a.shared_artists, 0) * 30
      + LEAST(s."favoritedTimes", 1000) + LEAST(s."ratingScore", 100))::int AS score
  FROM "Song" s
  LEFT JOIN tag_scores t ON t.id = s.id
  LEFT JOIN artist_scores a ON a.id = s.id
  WHERE s."sourceDeleted" = false
    AND s."lastSyncedAt" IS NOT NULL
    AND s."syncStatus" IN ('SYNCED', 'FAILED')
    AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = s.id)
    AND (t.id IS NOT NULL OR a.id IS NOT NULL)
)`;
}

/** Count-only CTEs mirroring the existing deep-page fallback query in repository.ts. */
const COUNT_TAG_SCORES_CTE = `
tag_scores AS (
  SELECT candidate."songId" AS id
  FROM "SongTag" candidate
  JOIN "SongTag" seed ON seed."tagId" = candidate."tagId"
  JOIN seeds ON seeds.id = seed."songId"
  GROUP BY candidate."songId"
),`;

const COUNT_ARTIST_SCORES_CTE = `
artist_scores AS (
  SELECT candidate."songId" AS id
  FROM "SongArtistCredit" candidate
  JOIN "SongArtistCredit" seed ON seed."artistId" = candidate."artistId"
  JOIN seeds ON seeds.id = seed."songId"
  WHERE candidate."artistId" IS NOT NULL AND seed."artistId" IS NOT NULL
  GROUP BY candidate."songId"
)`;

function seedCte(seedIds: string[]): string {
  return `seeds AS (
  SELECT value::uuid AS id FROM jsonb_array_elements_text('${JSON.stringify(seedIds)}'::jsonb) AS value
),`;
}

/**
 * C2 — single combined SQL. One statement returns the exact total and the
 * ordered page ids; `ranked` is materialized so the count is a plain scan of
 * the materialized candidate set and the page is a bounded top-N sort.
 */
async function getPersonalizedIdsCombined(
  tx: Prisma.TransactionClient,
  seedIds: string[],
  query: DiscoveryQuery,
): Promise<RankedResult> {
  const skip = (query.page - 1) * query.pageSize;
  const rows = await tx.$queryRaw<Array<{ totalCount: number; ids: string[] }>>(Prisma.sql`
    WITH ${Prisma.raw(seedCte(seedIds))}
    ${Prisma.raw(TAG_SCORES_CTE)}
    ${Prisma.raw(ARTIST_SCORES_CTE)}
    ${Prisma.raw(rankedCte(true))}
    SELECT
      (SELECT COUNT(*)::int FROM ranked) AS "totalCount",
      COALESCE(
        ARRAY(SELECT id FROM ranked ORDER BY score DESC, id ASC OFFSET ${skip} LIMIT ${query.pageSize}),
        ARRAY[]::uuid[]
      ) AS ids
  `);
  const totalCount = rows[0]?.totalCount ?? 0;
  return { rows: (rows[0]?.ids ?? []).map((id) => ({ id })), totalCount };
}

/**
 * C1 — two-query split in the same transaction. The page statement has no
 * window function (bounded top-N sort); the count statement is the existing
 * deep-page fallback promoted to always-run. The candidate join tree is
 * evaluated twice (page + count).
 */
async function getPersonalizedIdsSplitCount(
  tx: Prisma.TransactionClient,
  seedIds: string[],
  query: DiscoveryQuery,
): Promise<RankedResult> {
  const skip = (query.page - 1) * query.pageSize;
  const pageRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH ${Prisma.raw(seedCte(seedIds))}
    ${Prisma.raw(TAG_SCORES_CTE)}
    ${Prisma.raw(ARTIST_SCORES_CTE)}
    ${Prisma.raw(rankedCte(false))}
    SELECT id FROM ranked ORDER BY score DESC, id ASC OFFSET ${skip} LIMIT ${query.pageSize}
  `);
  const countRows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    WITH ${Prisma.raw(seedCte(seedIds))}
    ${Prisma.raw(COUNT_TAG_SCORES_CTE)}
    ${Prisma.raw(COUNT_ARTIST_SCORES_CTE)}
    SELECT COUNT(*)::int AS count
    FROM "Song" s
    WHERE s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
      AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = s.id)
      AND (EXISTS (SELECT 1 FROM tag_scores WHERE tag_scores.id = s.id)
        OR EXISTS (SELECT 1 FROM artist_scores WHERE artist_scores.id = s.id))
  `);
  return {
    rows: pageRows.map((row) => ({ id: row.id })),
    totalCount: countRows[0]?.count ?? 0,
  };
}

export async function getDiscoveryWithCombinedCte(
  viewerId: string | null,
  query: DiscoveryQuery,
  database: DiscoveryDb = getDb(),
): Promise<DiscoveryDto> {
  return runDiscoveryTransaction(database, viewerId, query, getPersonalizedIdsCombined);
}

export async function getDiscoveryWithSplitCount(
  viewerId: string | null,
  query: DiscoveryQuery,
  database: DiscoveryDb = getDb(),
): Promise<DiscoveryDto> {
  return runDiscoveryTransaction(database, viewerId, query, getPersonalizedIdsSplitCount);
}
