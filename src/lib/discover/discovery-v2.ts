import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { DiscoveryDto } from "@/lib/discover/dto";
import type { DiscoveryQuery } from "@/lib/discover/query";
import {
  runDiscoveryTransaction,
  type DiscoveryDb,
  type RankedResult,
} from "@/lib/discover/repository";

const FEATURE_LIMIT = 24;
const CANDIDATES_PER_FEATURE = 160;

/**
 * Bounded-candidate personalized discovery strategy for benchmark evaluation.
 *
 * It limits seed features by their seed support, expands a fixed number of
 * public non-seed songs for each selected feature, then applies V1's scoring
 * weights and ordering to that bounded candidate set. This module is not wired
 * into production routing; `getDiscovery` remains the V1 control.
 */
async function getPersonalizedIdsV2(
  tx: Prisma.TransactionClient,
  seedIds: string[],
  query: DiscoveryQuery,
): Promise<RankedResult> {
  const skip = (query.page - 1) * query.pageSize;
  const rows = await tx.$queryRaw<Array<{ totalCount: number; ids: string[] }>>(Prisma.sql`
    WITH seeds AS (
      SELECT value::uuid AS id
      FROM jsonb_array_elements_text(${JSON.stringify(seedIds)}::jsonb) AS value
    ),
    top_tags AS (
      SELECT seed."tagId" AS id, COUNT(DISTINCT seed."songId")::int AS seed_support
      FROM "SongTag" seed
      JOIN seeds ON seeds.id = seed."songId"
      GROUP BY seed."tagId"
      ORDER BY seed_support DESC, id ASC
      LIMIT ${FEATURE_LIMIT}
    ),
    top_artists AS (
      SELECT seed."artistId" AS id, COUNT(DISTINCT seed."songId")::int AS seed_support
      FROM "SongArtistCredit" seed
      JOIN seeds ON seeds.id = seed."songId"
      WHERE seed."artistId" IS NOT NULL
      GROUP BY seed."artistId"
      ORDER BY seed_support DESC, id ASC
      LIMIT ${FEATURE_LIMIT}
    ),
    candidate_ids AS (
      SELECT candidates.id
      FROM top_tags feature
      CROSS JOIN LATERAL (
        SELECT relation."songId" AS id
        FROM "SongTag" relation
        JOIN "Song" song ON song.id = relation."songId"
        WHERE relation."tagId" = feature.id
          AND song."sourceDeleted" = false
          AND song."lastSyncedAt" IS NOT NULL
          AND song."syncStatus" IN ('SYNCED', 'FAILED')
          AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = song.id)
        ORDER BY song."favoritedTimes" DESC, song."ratingScore" DESC, song.id ASC
        LIMIT ${CANDIDATES_PER_FEATURE}
      ) candidates
      UNION
      SELECT candidates.id
      FROM top_artists feature
      CROSS JOIN LATERAL (
        SELECT candidate.id
        FROM (
          SELECT DISTINCT song.id, song."favoritedTimes", song."ratingScore"
          FROM "SongArtistCredit" relation
          JOIN "Song" song ON song.id = relation."songId"
          WHERE relation."artistId" = feature.id
            AND song."sourceDeleted" = false
            AND song."lastSyncedAt" IS NOT NULL
            AND song."syncStatus" IN ('SYNCED', 'FAILED')
            AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = song.id)
        ) candidate
        ORDER BY candidate."favoritedTimes" DESC, candidate."ratingScore" DESC, candidate.id ASC
        LIMIT ${CANDIDATES_PER_FEATURE}
      ) candidates
    ),
    tag_scores AS (
      SELECT candidate.id, COUNT(DISTINCT seed."tagId")::int AS shared_tags
      FROM candidate_ids candidate
      JOIN "SongTag" candidate_tag ON candidate_tag."songId" = candidate.id
      JOIN "SongTag" seed ON seed."tagId" = candidate_tag."tagId"
      JOIN seeds ON seeds.id = seed."songId"
      GROUP BY candidate.id
    ),
    artist_scores AS (
      SELECT candidate.id, COUNT(DISTINCT seed."artistId")::int AS shared_artists
      FROM candidate_ids candidate
      JOIN "SongArtistCredit" candidate_artist ON candidate_artist."songId" = candidate.id
      JOIN "SongArtistCredit" seed ON seed."artistId" = candidate_artist."artistId"
      JOIN seeds ON seeds.id = seed."songId"
      WHERE candidate_artist."artistId" IS NOT NULL
        AND seed."artistId" IS NOT NULL
      GROUP BY candidate.id
    ),
    ranked AS (
      SELECT song.id,
        (COALESCE(tags.shared_tags, 0) * 100 + COALESCE(artists.shared_artists, 0) * 30
          + LEAST(song."favoritedTimes", 1000) + LEAST(song."ratingScore", 100))::int AS score
      FROM candidate_ids candidate
      JOIN "Song" song ON song.id = candidate.id
      LEFT JOIN tag_scores tags ON tags.id = song.id
      LEFT JOIN artist_scores artists ON artists.id = song.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM ranked) AS "totalCount",
      COALESCE(
        ARRAY(
          SELECT id
          FROM ranked
          ORDER BY score DESC, id ASC
          OFFSET ${skip}
          LIMIT ${query.pageSize}
        ),
        ARRAY[]::uuid[]
      ) AS ids
  `);

  return {
    rows: (rows[0]?.ids ?? []).map((id) => ({ id })),
    totalCount: rows[0]?.totalCount ?? 0,
  };
}

/**
 * Callable V2 entry point for benchmarks. Production continues to use the V1
 * `getDiscovery` entry point in repository.ts.
 */
export async function getDiscoveryV2(
  viewerId: string | null,
  query: DiscoveryQuery,
  database: DiscoveryDb = getDb(),
): Promise<DiscoveryDto> {
  return runDiscoveryTransaction(database, viewerId, query, getPersonalizedIdsV2);
}
