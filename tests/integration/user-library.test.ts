import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { listFavorites, setFavorite } from "@/lib/favorites/repository";
import {
  addPlaylistCollaborator,
  addPlaylistSong,
  createPlaylist,
  createPlaylistReport,
  disposePlaylistReport,
  getPlaylist,
  getPublicPlaylist,
  listOpenPlaylistReports,
  leavePlaylist,
  listPlaylists,
  movePlaylistSong,
  removePlaylistCollaborator,
  setPlaylistVisibility,
  removePlaylistSong,
} from "@/lib/playlists/repository";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => db.$connect());

async function cleanDatabase() {
  await db.playlistReport.deleteMany();
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

  it("shares by opaque token and lets editors mutate without owner controls", async () => {
    const owner = await seedUser("share-owner@example.com");
    const editor = await seedUser("share-editor@example.com");
    const stranger = await seedUser("share-stranger@example.com");
    const song = await seedSong(6, "Shared");
    expect(await createPlaylist(owner.id, { name: "Shared set", description: null })).toBe("CREATED");
    const playlist = await db.playlist.findFirstOrThrow({ where: { userId: owner.id } });

    expect(await addPlaylistCollaborator(owner.id, playlist.id, "share-editor@example.com")).toBe("ADDED");
    expect(await addPlaylistCollaborator(owner.id, playlist.id, "share-editor@example.com")).toBe("ALREADY_EXISTS");
    expect((await setPlaylistVisibility(owner.id, playlist.id, "PUBLIC")).status).toBe("UPDATED");
    const published = await db.playlist.findUniqueOrThrow({ where: { id: playlist.id } });
    expect(published.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await getPublicPlaylist(published.shareToken!))?.name).toBe("Shared set");
    expect(await getPlaylist(stranger.id, playlist.id)).toBeNull();
    expect((await listPlaylists(editor.id))[0]?.role).toBe("EDITOR");
    const editorDetail = await getPlaylist(owner.id, playlist.id);
    expect(editorDetail?.collaborators[0]).toMatchObject({
      name: null,
      email: "share-editor@example.com",
      role: "EDITOR",
    });
    expect(JSON.stringify(editorDetail?.collaborators)).toContain("share-editor@example.com");
    expect(await addPlaylistSong(editor.id, playlist.id, song.id)).toBe("UPDATED");
    expect((await setPlaylistVisibility(editor.id, playlist.id, "PRIVATE")).status).toBe("NOT_FOUND");
    expect(await removePlaylistCollaborator(stranger.id, playlist.id, editor.id)).toBe(false);
    expect(await leavePlaylist(editor.id, playlist.id)).toBe(true);
    expect(await getPlaylist(editor.id, playlist.id)).toBeNull();
    expect(await leavePlaylist(editor.id, playlist.id)).toBe(false);
    expect(await addPlaylistCollaborator(owner.id, playlist.id, "share-editor@example.com")).toBe("ADDED");
    expect(await removePlaylistCollaborator(owner.id, playlist.id, editor.id)).toBe(true);
    expect(await getPlaylist(editor.id, playlist.id)).toBeNull();
    const oldToken = published.shareToken!;
    expect((await setPlaylistVisibility(owner.id, playlist.id, "PRIVATE")).shareToken).toBeNull();
    expect(await getPublicPlaylist(oldToken)).toBeNull();
  });
  it("accepts reports only for matching active public shares and preserves target after deletion", async () => {
    const owner = await seedUser("report-owner@example.com");
    const reporter = await seedUser("reporter@example.com");
    expect(await createPlaylist(owner.id, { name: "Reported", description: null })).toBe("CREATED");
    const playlist = await db.playlist.findFirstOrThrow({ where: { userId: owner.id } });
    expect((await setPlaylistVisibility(owner.id, playlist.id, "PUBLIC")).status).toBe("UPDATED");
    const published = await db.playlist.findUniqueOrThrow({ where: { id: playlist.id } });
    const token = published.shareToken!;

    expect(await createPlaylistReport(reporter.id, playlist.id, "SPAM", " unwanted ", token)).toBe("CREATED");
    expect(await createPlaylistReport(reporter.id, playlist.id, "SPAM", null, token)).toBe("ALREADY_REPORTED");
    expect(await createPlaylistReport(reporter.id, playlist.id, "SPAM", null, "B".repeat(43))).toBe("NOT_FOUND");
    await db.playlist.update({ where: { id: playlist.id }, data: { moderationStatus: "HIDDEN" } });
    expect(await getPublicPlaylist(token)).toBeNull();
    await db.user.delete({ where: { id: owner.id } });
    const report = await db.playlistReport.findFirstOrThrow({ where: { targetPlaylistId: playlist.id } });
    expect(report.playlistId).toBeNull();
    expect(report.targetPlaylistId).toBe(playlist.id);
  });
  it("returns one created and one duplicate result for concurrent reports", async () => {
    const owner = await seedUser("concurrent-report-owner@example.com");
    const reporter = await seedUser("concurrent-reporter@example.com");
    expect(await createPlaylist(owner.id, { name: "Concurrent", description: null })).toBe("CREATED");
    const playlist = await db.playlist.findFirstOrThrow({ where: { userId: owner.id } });
    expect((await setPlaylistVisibility(owner.id, playlist.id, "PUBLIC")).status).toBe("UPDATED");
    const published = await db.playlist.findUniqueOrThrow({ where: { id: playlist.id } });
    const results = await Promise.all([
      createPlaylistReport(reporter.id, playlist.id, "SPAM", "first", published.shareToken!),
      createPlaylistReport(reporter.id, playlist.id, "SPAM", "second", published.shareToken!),
    ]);

    expect(results.sort()).toEqual(["ALREADY_REPORTED", "CREATED"]);
    expect(await db.playlistReport.count({ where: { reporterId: reporter.id, playlistId: playlist.id, status: "OPEN" } })).toBe(1);
  });
  it("lists and disposes reports without exposing private fields", async () => {
    const owner = await seedUser("triage-owner@example.com");
    const reporter = await seedUser("triage-reporter@example.com");
    expect(await createPlaylist(owner.id, { name: "Triage", description: null })).toBe("CREATED");
    const playlist = await db.playlist.findFirstOrThrow({ where: { userId: owner.id } });
    expect((await setPlaylistVisibility(owner.id, playlist.id, "PUBLIC")).status).toBe("UPDATED");
    const published = await db.playlist.findUniqueOrThrow({ where: { id: playlist.id } });
    expect(await createPlaylistReport(reporter.id, playlist.id, "SPAM", "private note", published.shareToken!)).toBe("CREATED");

    const queue = await listOpenPlaylistReports(10);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ targetPlaylistId: playlist.id, reason: "SPAM", status: "OPEN", resolvedAt: null, resolutionCode: null });
    expect(queue[0]).not.toHaveProperty("note");
    expect(queue[0]).not.toHaveProperty("reporterId");

    const reportId = queue[0].id;
    const [firstDisposition, secondDisposition] = await Promise.all([
      disposePlaylistReport(reportId, "RESOLVED", "confirmed-spam"),
      disposePlaylistReport(reportId, "DISMISSED", "duplicate"),
    ]);
    expect([firstDisposition, secondDisposition].filter((result) => result !== "ALREADY_DISPOSED")).toHaveLength(1);
    expect([firstDisposition, secondDisposition]).toContain("ALREADY_DISPOSED");
    expect(await listOpenPlaylistReports(10)).toHaveLength(0);
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
