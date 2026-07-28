import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { listFavorites, setFavorite } from "@/lib/favorites/repository";
import {
  addPlaylistSong,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistSong,
  removePlaylistSong,
} from "@/lib/playlists/repository";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => db.$connect());

async function cleanDatabase() {
  await db.playlistSong.deleteMany();
  await db.favorite.deleteMany();
  await db.playlist.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
}

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await db.$disconnect();
});

async function seedUser(email: string) {
  return db.user.create({ data: { email } });
}

async function seedSong(vocadbId: number, name: string, status = SyncStatus.SYNCED) {
  return db.song.create({
    data: {
      vocadbId,
      name,
      defaultName: name,
      defaultNameLanguage: "English",
      artistString: "Artist",
      songType: "Original",
      sourceStatus: "Finished",
      sourceCreatedAt: new Date("2026-01-01T00:00:00Z"),
      durationSeconds: 180,
      favoritedTimes: 42,
      ratingScore: 5,
      cultureCodes: [],
      sourceVersion: 1,
      lastSyncedAt: new Date("2026-07-01T00:00:00Z"),
      syncStatus: status,
    },
  });
}

describe("user library persistence", () => {
  it("adds and removes favorites idempotently without changing VocaDB counts", async () => {
    const user = await seedUser("favorite@example.com");
    const song = await seedSong(1, "Favorite Song");

    expect(await setFavorite(user.id, song.id, true)).toBe("UPDATED");
    expect(await setFavorite(user.id, song.id, true)).toBe("UPDATED");
    expect((await listFavorites(user.id, { page: 1, pageSize: 24 })).items).toHaveLength(1);
    expect((await db.song.findUniqueOrThrow({ where: { id: song.id } })).favoritedTimes).toBe(42);
    expect(await setFavorite(user.id, song.id, false)).toBe("UPDATED");
    expect(await setFavorite(user.id, song.id, false)).toBe("UPDATED");
  });

  it("retains an unavailable favorite without leaking song fields", async () => {
    const user = await seedUser("hidden@example.com");
    const song = await seedSong(2, "Private Title");
    await setFavorite(user.id, song.id, true);
    await db.song.update({ where: { id: song.id }, data: { syncStatus: SyncStatus.SOURCE_MISSING } });

    expect((await listFavorites(user.id, { page: 1, pageSize: 24 })).items[0]).toEqual({
      songId: song.id,
      createdAt: expect.any(String),
      available: false,
      song: null,
    });
  });

  it("updates playlist ordering when its entries change", async () => {
    const owner = await seedUser("ordering@example.com");
    const song = await seedSong(5, "Ordering");
    await createPlaylist(owner.id, { name: "Older", description: null });
    await createPlaylist(owner.id, { name: "Newer", description: null });
    const older = await db.playlist.findFirstOrThrow({ where: { userId: owner.id, name: "Older" } });
    const newer = await db.playlist.findFirstOrThrow({ where: { userId: owner.id, name: "Newer" } });
    await db.playlist.update({
      where: { id: older.id },
      data: { updatedAt: new Date("2026-01-01T00:00:00Z") },
    });
    await db.playlist.update({
      where: { id: newer.id },
      data: { updatedAt: new Date("2026-02-01T00:00:00Z") },
    });

    expect((await listPlaylists(owner.id))[0].id).toBe(newer.id);
    await addPlaylistSong(owner.id, older.id, song.id);
    expect((await listPlaylists(owner.id))[0].id).toBe(older.id);
  });

  it("keeps playlists private and reorders entries", async () => {
    const owner = await seedUser("owner@example.com");
    const stranger = await seedUser("stranger@example.com");
    const first = await seedSong(3, "First");
    const second = await seedSong(4, "Second");
    expect(await createPlaylist(owner.id, { name: "Set", description: null })).toBe("CREATED");
    const playlist = (await db.playlist.findFirstOrThrow({ where: { userId: owner.id } }));

    expect(await addPlaylistSong(owner.id, playlist.id, first.id)).toBe("UPDATED");
    expect(await addPlaylistSong(owner.id, playlist.id, second.id)).toBe("UPDATED");
    expect(await addPlaylistSong(owner.id, playlist.id, second.id)).toBe("UPDATED");
    expect(await getPlaylist(stranger.id, playlist.id)).toBeNull();
    expect(await movePlaylistSong(owner.id, playlist.id, second.id, "up")).toBe(true);
    expect((await getPlaylist(owner.id, playlist.id))?.entries.map((entry) => entry.songId)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await removePlaylistSong(owner.id, playlist.id, first.id)).toBe(true);
    expect(await removePlaylistSong(owner.id, playlist.id, first.id)).toBe(true);
  });
});
