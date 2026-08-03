import { Prisma } from "@/generated/prisma/client";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import { mapSongListItem, SONG_LIST_SELECT } from "@/lib/songs/repository";
import {
  DISCOVERY_ALGORITHM_VERSION,
  type DiscoveryDto,
  type DiscoveryMode,
} from "@/lib/discover/dto";
import type { DiscoveryQuery } from "@/lib/discover/query";

const DISCOVERY_SEED_LIMIT = 500;

const DISCOVERY_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 15_000,
} as const;

export type DiscoveryDb = Pick<ReturnType<typeof getDb>, "$transaction">;

type RankedSong = { id: string };
type RankedQueryRow = RankedSong & { totalCount: number };
type RankedResult = { rows: RankedSong[]; totalCount: number };

export async function getDiscovery(
  viewerId: string | null,
  query: DiscoveryQuery,
  database: DiscoveryDb = getDb(),
): Promise<DiscoveryDto> {
  return database.$transaction(async (tx) => {
    const seedIds = viewerId ? await getSeedIds(tx, viewerId) : [];
    const personalizedResult = seedIds.length > 0
      ? await getPersonalizedIds(tx, seedIds, query)
      : null;
    const personalized = personalizedResult !== null && personalizedResult.totalCount > 0;
    const mode: DiscoveryMode = personalized ? "PERSONALIZED" : "POPULAR";
    const ranked = personalizedResult && personalized
      ? personalizedResult
      : await getPopularIds(tx, query);
    const songs = await tx.song.findMany({
      where: { id: { in: ranked.rows.map((row) => row.id) }, ...PUBLIC_SONG_WHERE },
      select: SONG_LIST_SELECT,
    });
    const byId = new Map(songs.map((song) => [song.id, mapSongListItem(song)]));
    return {
      items: ranked.rows.flatMap((row) => {
        const song = byId.get(row.id);
        return song ? [song] : [];
      }),
      mode,
      algorithmVersion: DISCOVERY_ALGORITHM_VERSION,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: ranked.totalCount,
        totalPages: Math.ceil(ranked.totalCount / query.pageSize),
      },
    };
  }, DISCOVERY_TRANSACTION_OPTIONS);
}

async function getSeedIds(tx: Prisma.TransactionClient, viewerId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "songId" AS id FROM "Favorite" f
    JOIN "Song" s ON s.id = f."songId"
    WHERE f."userId" = ${viewerId}::uuid
      AND s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
    UNION
    SELECT ps."songId" AS id
    FROM "PlaylistSong" ps
    JOIN "Playlist" p ON p.id = ps."playlistId"
    JOIN "Song" s ON s.id = ps."songId"
    WHERE (p."userId" = ${viewerId}::uuid
       OR EXISTS (
         SELECT 1 FROM "PlaylistCollaborator" pc
         WHERE pc."playlistId" = p.id AND pc."userId" = ${viewerId}::uuid
       ))
      AND s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
    ORDER BY id ASC
    LIMIT ${DISCOVERY_SEED_LIMIT}
  `);
  return rows.map((row) => row.id);
}

async function getPersonalizedIds(
  tx: Prisma.TransactionClient,
  seedIds: string[],
  query: DiscoveryQuery,
): Promise<RankedResult> {
  const skip = (query.page - 1) * query.pageSize;
  const rows = await tx.$queryRaw<RankedQueryRow[]>(Prisma.sql`
    WITH seeds AS (
      SELECT value::uuid AS id FROM jsonb_array_elements_text(${JSON.stringify(seedIds)}::jsonb) AS value
    ),
    tag_scores AS (
      SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."tagId")::int AS shared_tags
      FROM "SongTag" candidate
      JOIN "SongTag" seed ON seed."tagId" = candidate."tagId"
      JOIN seeds ON seeds.id = seed."songId"
      GROUP BY candidate."songId"
    ),
    artist_scores AS (
      SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."artistId")::int AS shared_artists
      FROM "SongArtistCredit" candidate
      JOIN "SongArtistCredit" seed ON seed."artistId" = candidate."artistId"
      JOIN seeds ON seeds.id = seed."songId"
      WHERE candidate."artistId" IS NOT NULL
        AND seed."artistId" IS NOT NULL
      GROUP BY candidate."songId"
    ),
    ranked AS (
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
    )
    SELECT id, COUNT(*) OVER()::int AS "totalCount"
    FROM ranked
    ORDER BY score DESC, id ASC
    OFFSET ${skip}
    LIMIT ${query.pageSize}
  `);
  const totalCount = rows[0]?.totalCount ?? (skip === 0 ? 0 : Number((await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    WITH seeds AS (
      SELECT value::uuid AS id FROM jsonb_array_elements_text(${JSON.stringify(seedIds)}::jsonb) AS value
    ),
    tag_scores AS (
      SELECT candidate."songId" AS id
      FROM "SongTag" candidate
      JOIN "SongTag" seed ON seed."tagId" = candidate."tagId"
      JOIN seeds ON seeds.id = seed."songId"
      GROUP BY candidate."songId"
    ),
    artist_scores AS (
      SELECT candidate."songId" AS id
      FROM "SongArtistCredit" candidate
      JOIN "SongArtistCredit" seed ON seed."artistId" = candidate."artistId"
      JOIN seeds ON seeds.id = seed."songId"
      WHERE candidate."artistId" IS NOT NULL AND seed."artistId" IS NOT NULL
      GROUP BY candidate."songId"
    )
    SELECT COUNT(*)::int AS count
    FROM "Song" s
    WHERE s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
      AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = s.id)
      AND (EXISTS (SELECT 1 FROM tag_scores WHERE tag_scores.id = s.id)
        OR EXISTS (SELECT 1 FROM artist_scores WHERE artist_scores.id = s.id))
  `))[0]?.count ?? 0));
  return { rows: rows.map((row) => ({ id: row.id })), totalCount };
}

async function getPopularIds(
  tx: Prisma.TransactionClient,
  query: DiscoveryQuery,
): Promise<RankedResult> {
  const skip = (query.page - 1) * query.pageSize;
  const rows = await tx.song.findMany({
    where: PUBLIC_SONG_WHERE,
    orderBy: [{ favoritedTimes: "desc" }, { ratingScore: "desc" }, { id: "asc" }],
    skip,
    take: query.pageSize,
    select: { id: true },
  });
  const totalCount = await tx.song.count({ where: PUBLIC_SONG_WHERE });
  return { rows: rows.map((row) => ({ id: row.id })), totalCount };
}
