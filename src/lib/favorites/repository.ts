import { Prisma } from "@/generated/prisma/client";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { FavoriteListDto } from "@/lib/favorites/dto";
import type { FavoriteListQuery } from "@/lib/favorites/query";
import { mapSongListItem, SONG_LIST_SELECT } from "@/lib/songs/repository";

export async function listFavorites(
  userId: string,
  query: FavoriteListQuery,
): Promise<FavoriteListDto> {
  return getDb().$transaction(async (tx) => {
    const totalItems = await tx.favorite.count({ where: { userId } });
    const rows = await tx.favorite.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { songId: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { songId: true, createdAt: true },
    });
    const songs = await tx.song.findMany({
      where: { id: { in: rows.map((row) => row.songId) }, ...PUBLIC_SONG_WHERE },
      select: SONG_LIST_SELECT,
    });
    const byId = new Map(songs.map((song) => [song.id, mapSongListItem(song)]));
    return {
      items: rows.map((row) => ({
        songId: row.songId,
        createdAt: row.createdAt.toISOString(),
        available: byId.has(row.songId),
        song: byId.get(row.songId) ?? null,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function isFavorite(userId: string, songId: string): Promise<boolean> {
  return (await getDb().favorite.count({ where: { userId, songId } })) > 0;
}

export async function setFavorite(
  userId: string,
  songId: string,
  desired: boolean,
): Promise<"UPDATED" | "NOT_FOUND"> {
  const db = getDb();
  if (!desired) {
    await db.favorite.deleteMany({ where: { userId, songId } });
    return "UPDATED";
  }

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Song"
      WHERE id = ${songId}::uuid
        AND "sourceDeleted" = false
        AND "lastSyncedAt" IS NOT NULL
        AND "syncStatus" IN ('SYNCED', 'FAILED')
      FOR SHARE
    `);
    if (rows.length !== 1) return "NOT_FOUND";
    await tx.favorite.upsert({
      where: { userId_songId: { userId, songId } },
      create: { userId, songId },
      update: {},
    });
    return "UPDATED";
  });
}

export type FavoriteTransaction = Prisma.TransactionClient;
