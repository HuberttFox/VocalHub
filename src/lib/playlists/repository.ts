import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { PlaylistVisibility } from "@/generated/prisma/enums";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { PlaylistDetailDto, PlaylistRole, PlaylistSummaryDto, PublicPlaylistDto } from "@/lib/playlists/dto";
import {
  PLAYLIST_COLLABORATOR_LIMIT,
  PLAYLIST_LIMIT,
  PLAYLIST_SONG_LIMIT,
  SHARE_TOKEN_PATTERN,
} from "@/lib/playlists/query";
import { mapSongListItem, SONG_LIST_SELECT } from "@/lib/songs/repository";

const playlistSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  visibility: true,
  moderationStatus: true,
  shareToken: true,
  userId: true,
  collaborators: {
    select: {
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { userId: "asc" },
  },
  _count: { select: { songs: true } },
} satisfies Prisma.PlaylistSelect;

type PlaylistRow = Prisma.PlaylistGetPayload<{ select: typeof playlistSelect }>;

export async function listPlaylists(userId: string): Promise<PlaylistSummaryDto[]> {
  const rows = await getDb().playlist.findMany({
    where: {
      OR: [{ userId }, { collaborators: { some: { userId } } }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: playlistSelect,
  });
  return rows.map((row) => mapPlaylist(row, row.userId === userId ? "OWNER" : "EDITOR"));
}

export async function getPlaylist(
  userId: string,
  playlistId: string,
): Promise<PlaylistDetailDto | null> {
  return getDb().$transaction(async (tx) => {
    const playlist = await tx.playlist.findFirst({
      where: {
        id: playlistId,
        OR: [{ userId }, { collaborators: { some: { userId } } }],
      },
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
      ...mapPlaylist(playlist, playlist.userId === userId ? "OWNER" : "EDITOR"),
      collaborators: playlist.collaborators.map((collaborator) => ({
        userId: collaborator.userId,
        name: collaborator.user.name,
        email: collaborator.user.email,
        role: collaborator.role,
        createdAt: collaborator.createdAt.toISOString(),
      })),
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

export async function getPublicPlaylist(shareToken: string): Promise<PublicPlaylistDto | null> {
  if (!SHARE_TOKEN_PATTERN.test(shareToken)) return null;
  return getDb().$transaction(async (tx) => {
    const playlist = await tx.playlist.findFirst({
      where: { shareToken, visibility: PlaylistVisibility.PUBLIC, moderationStatus: "ACTIVE" },
      select: playlistSelect,
    });
    if (!playlist) return null;
    const entries = await tx.playlistSong.findMany({
      where: { playlistId: playlist.id },
      orderBy: [{ position: "asc" }, { songId: "asc" }],
      select: { songId: true, position: true, addedAt: true },
    });
    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      entries: await mapEntries(tx, entries),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function createPlaylistReport(
  reporterId: string,
  playlistId: string,
  reason: "ILLEGAL" | "ABUSIVE" | "PERSONAL_DATA" | "SPAM" | "OTHER",
  note: string | null,
  shareToken: string,
): Promise<"CREATED" | "ALREADY_REPORTED" | "NOT_FOUND"> {
  const createReport = () => getDb().$transaction(async (tx) => {
    const playlist = await tx.playlist.findFirst({
      where: { id: playlistId, shareToken, visibility: PlaylistVisibility.PUBLIC, moderationStatus: "ACTIVE" },
      select: { id: true },
    });
    if (!playlist) return "NOT_FOUND" as const;
    const existing = await tx.playlistReport.findFirst({
      where: { reporterId, playlistId, status: "OPEN" },
      select: { id: true },
    });
    if (existing) return "ALREADY_REPORTED" as const;
    await tx.playlistReport.create({ data: { reporterId, playlistId, targetPlaylistId: playlistId, reason, note } });
    return "CREATED" as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createReport();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await getDb().playlistReport.findFirst({
          where: { reporterId, playlistId, status: "OPEN" },
          select: { id: true },
        });
        if (existing) return "ALREADY_REPORTED";
      }
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error("PLAYLIST_REPORT_RETRY_EXHAUSTED");
}

export type PlaylistReportQueueItem = {
  id: string;
  targetPlaylistId: string;
  reason: "ILLEGAL" | "ABUSIVE" | "PERSONAL_DATA" | "SPAM" | "OTHER";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  resolvedAt: string | null;
  resolutionCode: string | null;
};

const playlistReportOperatorSelect = {
  id: true,
  targetPlaylistId: true,
  reason: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  resolutionCode: true,
} satisfies Prisma.PlaylistReportSelect;

type PlaylistReportOperatorRow = Prisma.PlaylistReportGetPayload<{ select: typeof playlistReportOperatorSelect }>;

function mapPlaylistReportOperator(row: PlaylistReportOperatorRow): PlaylistReportQueueItem {
  return {
    id: row.id,
    targetPlaylistId: row.targetPlaylistId,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionCode: row.resolutionCode,
  };
}

export async function listOpenPlaylistReports(limit: number): Promise<PlaylistReportQueueItem[]> {
  const rows = await getDb().playlistReport.findMany({
    where: { status: "OPEN" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: playlistReportOperatorSelect,
  });
  return rows.map(mapPlaylistReportOperator);
}

export async function disposePlaylistReport(
  reportId: string,
  status: "RESOLVED" | "DISMISSED",
  resolutionCode: string,
): Promise<PlaylistReportQueueItem | "NOT_FOUND" | "ALREADY_DISPOSED"> {
  return getDb().$transaction(async (tx) => {
    const report = await tx.playlistReport.findUnique({ where: { id: reportId }, select: playlistReportOperatorSelect });
    if (!report) return "NOT_FOUND";
    if (report.status !== "OPEN") return "ALREADY_DISPOSED";
    const updated = await tx.playlistReport.updateMany({
      where: { id: reportId, status: "OPEN" },
      data: { status, resolutionCode, resolvedAt: new Date() },
    });
    if (updated.count === 0) return "ALREADY_DISPOSED";
    const settled = await tx.playlistReport.findUniqueOrThrow({ where: { id: reportId }, select: playlistReportOperatorSelect });
    return mapPlaylistReportOperator(settled);
  });
}

export async function setPlaylistModerationStatus(
  playlistId: string,
  status: "ACTIVE" | "HIDDEN",
  resolutionCode: string | null = null,
): Promise<"UPDATED" | "NOT_FOUND"> {
  return getDb().$transaction(async (tx) => {
    const playlist = await tx.playlist.findUnique({ where: { id: playlistId }, select: { id: true } });
    if (!playlist) return "NOT_FOUND";
    await tx.playlist.update({ where: { id: playlistId }, data: { moderationStatus: status } });
    await tx.playlistReport.updateMany({
      where: { playlistId, status: "OPEN" },
      data: { status: status === "HIDDEN" ? "RESOLVED" : "DISMISSED", resolutionCode, resolvedAt: new Date() },
    });
    return "UPDATED";
  });
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

export async function setPlaylistVisibility(
  userId: string,
  playlistId: string,
  visibility: "PRIVATE" | "PUBLIC",
): Promise<{ status: "UPDATED" | "NOT_FOUND"; shareToken: string | null }> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist || playlist.userId !== userId) return { status: "NOT_FOUND", shareToken: null };
    const shareToken = visibility === "PUBLIC" ? createShareToken() : null;
    await tx.playlist.update({ where: { id: playlistId }, data: { visibility, shareToken } });
    return { status: "UPDATED", shareToken };
  });
}

export async function addPlaylistCollaborator(
  userId: string,
  playlistId: string,
  email: string,
): Promise<"ADDED" | "NOT_FOUND" | "ALREADY_EXISTS" | "LIMIT_REACHED"> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist || playlist.userId !== userId) return "NOT_FOUND";
    const target = await tx.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    if (!target || target.id === userId) return "NOT_FOUND";
    if (await tx.playlistCollaborator.findUnique({ where: { playlistId_userId: { playlistId, userId: target.id } } })) return "ALREADY_EXISTS";
    if (await tx.playlistCollaborator.count({ where: { playlistId } }) >= PLAYLIST_COLLABORATOR_LIMIT) return "LIMIT_REACHED";
    await tx.playlistCollaborator.create({ data: { playlistId, userId: target.id } });
    return "ADDED";
  });
}

export async function removePlaylistCollaborator(userId: string, playlistId: string, collaboratorId: string): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist || playlist.userId !== userId) return false;
    return (await tx.playlistCollaborator.deleteMany({ where: { playlistId, userId: collaboratorId } })).count === 1;
  });
}

export async function leavePlaylist(userId: string, playlistId: string): Promise<boolean> {
  return (await getDb().playlistCollaborator.deleteMany({ where: { playlistId, userId } })).count === 1;
}

function createShareToken(): string {
  return randomBytes(32).toString("base64url");
}
export async function updatePlaylist(
  userId: string,
  playlistId: string,
  data: { name: string; description: string | null },
): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist) return false;
    const result = await tx.playlist.updateMany({ where: { id: playlistId }, data });
    return result.count === 1;
  });
}

export async function deletePlaylist(userId: string, playlistId: string): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist || playlist.userId !== userId) return false;
    return (await tx.playlist.deleteMany({ where: { id: playlistId } })).count === 1;
  });
}

export async function addPlaylistSong(
  userId: string,
  playlistId: string,
  songId: string,
): Promise<"UPDATED" | "NOT_FOUND" | "LIMIT_REACHED"> {
  return getDb().$transaction(async (tx) => {
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist) return "NOT_FOUND";
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
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist) return false;
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
    const playlist = await lockPlaylist(tx, userId, playlistId);
    if (!playlist) return false;
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

async function mapEntries(
  tx: Prisma.TransactionClient,
  entries: Array<{ songId: string; position: number; addedAt: Date }>,
) {
  const songs = await tx.song.findMany({
    where: { id: { in: entries.map((entry) => entry.songId) }, ...PUBLIC_SONG_WHERE },
    select: SONG_LIST_SELECT,
  });
  const byId = new Map(songs.map((song) => [song.id, mapSongListItem(song)]));
  return entries.map((entry) => ({
    songId: entry.songId,
    position: entry.position,
    addedAt: entry.addedAt.toISOString(),
    available: byId.has(entry.songId),
    song: byId.get(entry.songId) ?? null,
  }));
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
): Promise<{ id: string; userId: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>(Prisma.sql`
    SELECT id, "userId" FROM "Playlist"
    WHERE id = ${playlistId}::uuid
      AND ("userId" = ${userId}::uuid OR EXISTS (
        SELECT 1 FROM "PlaylistCollaborator"
        WHERE "playlistId" = "Playlist".id AND "userId" = ${userId}::uuid
      ))
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function mapPlaylist(row: PlaylistRow, role: PlaylistRole): PlaylistSummaryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    itemCount: row._count.songs,
    visibility: row.visibility,
    moderationStatus: row.moderationStatus,
    shareToken: role === "OWNER" ? row.shareToken : null,
    role,
  };
}
