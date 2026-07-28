import { Prisma } from "@/generated/prisma/client";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { PlaylistDetailDto, PlaylistSummaryDto } from "@/lib/playlists/dto";
import { PLAYLIST_LIMIT, PLAYLIST_SONG_LIMIT } from "@/lib/playlists/query";
import { mapSongListItem, SONG_LIST_SELECT } from "@/lib/songs/repository";

const playlistSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { songs: true } },
} satisfies Prisma.PlaylistSelect;

type PlaylistRow = Prisma.PlaylistGetPayload<{ select: typeof playlistSelect }>;

export async function listPlaylists(userId: string): Promise<PlaylistSummaryDto[]> {
  const rows = await getDb().playlist.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: playlistSelect,
  });
  return rows.map(mapPlaylist);
}

export async function getPlaylist(
  userId: string,
  playlistId: string,
): Promise<PlaylistDetailDto | null> {
  return getDb().$transaction(async (tx) => {
    const playlist = await tx.playlist.findFirst({
      where: { id: playlistId, userId },
      select: playlistSelect,
    });
    if (!playlist) return null;
    const entries = await tx.playlistSong.findMany({
      where: { playlistId },
      orderBy: [{ position: "asc" }, { songId: "asc" }],
      select: { songId: true, position: true, addedAt: true },
    });
    const songs = await tx.song.findMany({
      where: { id: { in: entries.map((entry) => entry.songId) }, ...PUBLIC_SONG_WHERE },
      select: SONG_LIST_SELECT,
    });
    const byId = new Map(songs.map((song) => [song.id, mapSongListItem(song)]));
    return {
      ...mapPlaylist(playlist),
      entries: entries.map((entry) => ({
        songId: entry.songId,
        position: entry.position,
        addedAt: entry.addedAt.toISOString(),
        available: byId.has(entry.songId),
        song: byId.get(entry.songId) ?? null,
      })),
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function createPlaylist(
  userId: string,
  data: { name: string; description: string | null },
): Promise<"CREATED" | "LIMIT_REACHED"> {
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`);
    if (await tx.playlist.count({ where: { userId } }) >= PLAYLIST_LIMIT) {
      return "LIMIT_REACHED";
    }
    await tx.playlist.create({ data: { userId, ...data } });
    return "CREATED";
  });
}

export async function updatePlaylist(
  userId: string,
  playlistId: string,
  data: { name: string; description: string | null },
): Promise<boolean> {
  const result = await getDb().playlist.updateMany({
    where: { id: playlistId, userId },
    data,
  });
  return result.count === 1;
}

export async function deletePlaylist(userId: string, playlistId: string): Promise<boolean> {
  const result = await getDb().playlist.deleteMany({ where: { id: playlistId, userId } });
  return result.count === 1;
}

export async function addPlaylistSong(
  userId: string,
  playlistId: string,
  songId: string,
): Promise<"UPDATED" | "NOT_FOUND" | "LIMIT_REACHED"> {
  return getDb().$transaction(async (tx) => {
    if (!(await lockPlaylist(tx, userId, playlistId))) return "NOT_FOUND";
    if (await tx.playlistSong.findUnique({
      where: { playlistId_songId: { playlistId, songId } },
      select: { songId: true },
    })) return "UPDATED";
    if (await tx.playlistSong.count({ where: { playlistId } }) >= PLAYLIST_SONG_LIMIT) {
      return "LIMIT_REACHED";
    }
    const songs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Song"
      WHERE id = ${songId}::uuid
        AND "sourceDeleted" = false
        AND "lastSyncedAt" IS NOT NULL
        AND "syncStatus" IN ('SYNCED', 'FAILED')
      FOR SHARE
    `);
    if (songs.length !== 1) return "NOT_FOUND";
    const maximum = await tx.playlistSong.aggregate({ where: { playlistId }, _max: { position: true } });
    await tx.playlistSong.create({
      data: { playlistId, songId, position: (maximum._max.position ?? -1) + 1 },
    });
    await touchPlaylist(tx, playlistId);
    return "UPDATED";
  });
}

export async function removePlaylistSong(
  userId: string,
  playlistId: string,
  songId: string,
): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    if (!(await lockPlaylist(tx, userId, playlistId))) return false;
    const removed = await tx.playlistSong.deleteMany({ where: { playlistId, songId } });
    if (removed.count > 0) await touchPlaylist(tx, playlistId);
    return true;
  });
}

export async function movePlaylistSong(
  userId: string,
  playlistId: string,
  songId: string,
  direction: "up" | "down",
): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    if (!(await lockPlaylist(tx, userId, playlistId))) return false;
    const current = await tx.playlistSong.findUnique({
      where: { playlistId_songId: { playlistId, songId } },
      select: { position: true },
    });
    if (!current) return false;
    const neighbor = await tx.playlistSong.findFirst({
      where: {
        playlistId,
        position: direction === "up" ? { lt: current.position } : { gt: current.position },
      },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
      select: { songId: true, position: true },
    });
    if (!neighbor) return true;
    const maximum = await tx.playlistSong.aggregate({ where: { playlistId }, _max: { position: true } });
    const temporary = (maximum._max.position ?? 0) + 1;
    await tx.playlistSong.update({
      where: { playlistId_songId: { playlistId, songId } },
      data: { position: temporary },
    });
    await tx.playlistSong.update({
      where: { playlistId_songId: { playlistId, songId: neighbor.songId } },
      data: { position: current.position },
    });
    await tx.playlistSong.update({
      where: { playlistId_songId: { playlistId, songId } },
      data: { position: neighbor.position },
    });
    await touchPlaylist(tx, playlistId);
    return true;
  });
}

async function touchPlaylist(
  tx: Prisma.TransactionClient,
  playlistId: string,
): Promise<void> {
  await tx.playlist.update({
    where: { id: playlistId },
    data: { updatedAt: new Date() },
  });
}

async function lockPlaylist(
  tx: Prisma.TransactionClient,
  userId: string,
  playlistId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Playlist"
    WHERE id = ${playlistId}::uuid AND "userId" = ${userId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

function mapPlaylist(row: PlaylistRow): PlaylistSummaryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    itemCount: row._count.songs,
  };
}
