import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { deleteUserAccount, getAccountExport, revokeUserSessions } from "@/lib/account/repository";
import {
  databaseSessionCleanupCutoff,
  deleteExpiredSessions,
} from "@/lib/auth/session-cleanup";

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
  await db.song.deleteMany();
}

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await db.$disconnect();
});

async function seedUser(email: string) {
  return db.user.create({ data: { email, name: email.split("@")[0] } });
}

async function seedSong(vocadbId: number) {
  return db.song.create({
    data: {
      vocadbId,
      name: `Song ${vocadbId}`,
      defaultName: `Song ${vocadbId}`,
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
      syncStatus: SyncStatus.SYNCED,
    },
  });
}

async function seedSession(userId: string, token: string, expires: Date) {
  return db.session.create({ data: { userId, sessionToken: token, expires } });
}

describe("account lifecycle", () => {
  it("deletes every private record while retaining catalog and other users", async () => {
    const target = await seedUser("target@example.com");
    const other = await seedUser("other@example.com");
    const song = await seedSong(9001);
    await db.account.create({
      data: {
        userId: target.id,
        type: "oauth",
        provider: "github",
        providerAccountId: "target-github",
        access_token: "legacy-token",
      },
    });
    await seedSession(target.id, "target-current", new Date("2026-08-01T00:00:00Z"));
    await seedSession(target.id, "target-other", new Date("2026-08-02T00:00:00Z"));
    await seedSession(other.id, "other-session", new Date("2026-08-03T00:00:00Z"));
    await db.favorite.create({ data: { userId: target.id, songId: song.id } });
    const playlist = await db.playlist.create({ data: { userId: target.id, name: "Private" } });
    await db.playlistSong.create({ data: { playlistId: playlist.id, songId: song.id, position: 0 } });

    expect(await deleteUserAccount(target.id)).toBe(true);
    expect(await deleteUserAccount(target.id)).toBe(false);
    expect(await db.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await db.account.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.favorite.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.playlist.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.playlistSong.count({ where: { playlistId: playlist.id } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await db.session.findUnique({ where: { sessionToken: "other-session" } })).not.toBeNull();
    expect(await db.song.findUniqueOrThrow({ where: { id: song.id } })).toMatchObject({
      name: "Song 9001",
      favoritedTimes: 42,
    });
  });

  it("exports only the user's private data without OAuth tokens", async () => {
    const target = await seedUser("export@example.com");
    const other = await seedUser("export-other@example.com");
    const publicSong = await seedSong(9002);
    const hiddenSong = await seedSong(9003);
    await db.song.update({
      where: { id: hiddenSong.id },
      data: { syncStatus: SyncStatus.PENDING },
    });
    await db.account.create({
      data: {
        userId: target.id,
        type: "oauth",
        provider: "github",
        providerAccountId: "export-github",
        access_token: "must-not-export",
        refresh_token: "must-not-export",
        id_token: "must-not-export",
      },
    });
    await db.account.create({
      data: {
        userId: other.id,
        type: "oauth",
        provider: "github",
        providerAccountId: "other-github",
      },
    });
    await db.favorite.create({ data: { userId: other.id, songId: publicSong.id } });
    const otherPlaylist = await db.playlist.create({
      data: { userId: other.id, name: "Other private list" },
    });
    await db.playlistSong.create({
      data: { playlistId: otherPlaylist.id, songId: publicSong.id, position: 0 },
    });
    await db.favorite.create({ data: { userId: target.id, songId: hiddenSong.id } });
    await db.favorite.create({ data: { userId: target.id, songId: publicSong.id } });
    const playlist = await db.playlist.create({
      data: { userId: target.id, name: "Export picks", description: "Private" },
    });
    await db.playlistSong.createMany({
      data: [
        { playlistId: playlist.id, songId: hiddenSong.id, position: 1 },
        { playlistId: playlist.id, songId: publicSong.id, position: 0 },
      ],
    });

    const exported = await getAccountExport(target.id);

    expect(exported).not.toBeNull();
    expect(exported?.account.id).toBe(target.id);
    expect(exported?.account.providers).toEqual([
      { provider: "github", providerAccountId: "export-github" },
    ]);
    expect(exported?.account.image).toBeNull();
    expect(exported?.collaboratorMemberships).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain("other-github");
    expect(JSON.stringify(exported)).not.toContain("Other private list");
    expect(JSON.stringify(exported)).not.toContain("must-not-export");
    expect(exported?.favorites.map((favorite) => [favorite.songId, favorite.available])).toEqual([
      [hiddenSong.id, false],
      [publicSong.id, true],
    ]);
    expect(exported?.playlists[0]?.entries.map((entry) => [entry.position, entry.songId])).toEqual([
      [0, publicSong.id],
      [1, hiddenSong.id],
    ]);
    expect(exported?.playlists[0]?.entries[1]?.song).toBeNull();
    expect(exported?.playlists[0]?.entries[0]?.song?.title).toBe("Song 9002");
  });
  it("revokes only one user's sessions idempotently", async () => {
    const target = await seedUser("sessions@example.com");
    const other = await seedUser("sessions-other@example.com");
    await seedSession(target.id, "target-one", new Date("2026-08-01T00:00:00Z"));
    await seedSession(target.id, "target-two", new Date("2026-08-02T00:00:00Z"));
    await seedSession(other.id, "other-one", new Date("2026-08-03T00:00:00Z"));

    expect(await revokeUserSessions(target.id)).toBe(2);
    expect(await revokeUserSessions(target.id)).toBe(0);
    expect(await db.session.findUnique({ where: { sessionToken: "other-one" } })).not.toBeNull();
  });

  it("derives the cleanup cutoff from PostgreSQL time", async () => {
    const before = Date.now() - 5 * 60 * 1_000;
    const cutoff = await databaseSessionCleanupCutoff(db);
    const after = Date.now() - 5 * 60 * 1_000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 2_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after + 2_000);
  });

  it("cleans only sessions strictly older than the cutoff", async () => {
    const user = await seedUser("cleanup@example.com");
    const cutoff = new Date("2026-07-29T11:55:00Z");
    await seedSession(user.id, "old", new Date("2026-07-29T11:54:59Z"));
    await seedSession(user.id, "equal", cutoff);
    await seedSession(user.id, "future", new Date("2026-07-29T12:01:00Z"));

    expect(await deleteExpiredSessions(db, cutoff)).toBe(1);
    expect(await deleteExpiredSessions(db, cutoff)).toBe(0);
    expect(await db.session.findUnique({ where: { sessionToken: "equal" } })).not.toBeNull();
    expect(await db.session.findUnique({ where: { sessionToken: "future" } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});
