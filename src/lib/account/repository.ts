import { Prisma } from "@/generated/prisma/client";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { AccountExport, AccountExportSong } from "@/lib/account/dto";
import { ACCOUNT_EXPORT_VERSION } from "@/lib/account/dto";
import { mapSongListItem, SONG_LIST_SELECT } from "@/lib/songs/repository";

export type AccountSettingsDto = {
  name: string | null;
  email: string | null;
  createdAt: string;
  providers: string[];
};

export async function getAccountSettings(userId: string): Promise<AccountSettingsDto | null> {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      createdAt: true,
      accounts: { select: { provider: true }, orderBy: { provider: "asc" } },
    },
  });
  return user
    ? {
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        providers: [...new Set(user.accounts.map((account) => account.provider))],
      }
    : null;
}

export async function getAccountExport(userId: string): Promise<AccountExport | null> {
  return getDb().$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        accounts: {
          select: { provider: true, providerAccountId: true },
          orderBy: [{ provider: "asc" }, { providerAccountId: "asc" }],
        },
        favorites: {
          select: { songId: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { songId: "asc" }],
        },
        collaborations: {
          select: { playlistId: true, role: true, createdAt: true },
          orderBy: [{ playlistId: "asc" }],
        },
        playlists: {
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            songs: {
              select: { songId: true, position: true, addedAt: true },
              orderBy: [{ position: "asc" }, { songId: "asc" }],
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!user) return null;

    const songIds = [
      ...user.favorites.map((favorite) => favorite.songId),
      ...user.playlists.flatMap((playlist) => playlist.songs.map((song) => song.songId)),
    ];
    const songs = await tx.song.findMany({
      where: { id: { in: [...new Set(songIds)] }, ...PUBLIC_SONG_WHERE },
      select: SONG_LIST_SELECT,
    });
    const songById = new Map(songs.map((song) => [song.id, mapSongListItem(song)]));
    const mapSong = (songId: string): AccountExportSong => ({
      songId,
      available: songById.has(songId),
      song: songById.get(songId) ?? null,
    });

    return {
      type: "vocalhub-account-export",
      version: ACCOUNT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt.toISOString(),
        providers: user.accounts,
      },
      favorites: user.favorites.map((favorite) => ({
        ...mapSong(favorite.songId),
        createdAt: favorite.createdAt.toISOString(),
      })),
      collaboratorMemberships: user.collaborations.map((collaboration) => ({
        playlistId: collaboration.playlistId,
        role: collaboration.role,
        createdAt: collaboration.createdAt.toISOString(),
      })),
      playlists: user.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        createdAt: playlist.createdAt.toISOString(),
        updatedAt: playlist.updatedAt.toISOString(),
        entries: playlist.songs.map((song) => ({
          ...mapSong(song.songId),
          position: song.position,
          addedAt: song.addedAt.toISOString(),
        })),
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function disconnectAccountProvider(
  userId: string,
  provider: string,
): Promise<"DISCONNECTED" | "LAST_PROVIDER" | "NOT_FOUND"> {
  const normalizedProvider = provider.trim().toLowerCase();
  return getDb().$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE
    `);
    if (users.length === 0) return "NOT_FOUND";

    const accounts = await tx.account.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
    const providers = new Set(accounts.map((account) => account.provider));
    if (!providers.has(normalizedProvider)) return "NOT_FOUND";
    if (providers.size <= 1) return "LAST_PROVIDER";

    await tx.account.deleteMany({ where: { userId, provider: normalizedProvider } });
    await tx.session.deleteMany({ where: { userId } });
    return "DISCONNECTED";
  });
}

export async function revokeUserSessions(userId: string): Promise<number> {
  return (await getDb().session.deleteMany({ where: { userId } })).count;
}

export async function deleteUserAccount(userId: string): Promise<boolean> {
  return (await getDb().user.deleteMany({ where: { id: userId } })).count > 0;
}
