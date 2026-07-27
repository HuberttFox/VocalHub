import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncEntity, SyncStatus } from "@/generated/prisma/enums";
import { runVocaDbArtistSync } from "@/lib/vocadb/artist-sync-runner";
import { vocaDbArtistDetailSchema, vocaDbSongSchema } from "@/lib/vocadb/contract";
import { VocaDbCancellationError } from "@/lib/vocadb/errors";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { makeVocaDbArtistFixture } from "../fixtures/vocadb/artist";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const logger = { log() {}, error() {} };

beforeAll(async () => db.$connect());
beforeEach(async () => {
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
  await db.artistWebLink.deleteMany();
  await db.artistName.deleteMany();
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

async function seedArtist() {
  await syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture)),
  );
  return db.artist.findUniqueOrThrow({ where: { vocadbId: 100 } });
}

describe("durable artist refresh", () => {
  it("discovers local public artists and persists a durable manifest", async () => {
    await seedArtist();
    const result = await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        client: {
          getArtist: async () =>
            vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
        },
        now: () => new Date("2026-07-28T01:00:00Z"),
      },
    );

    expect(result).toMatchObject({ successCount: 1, failureCount: 0 });
    const run = await db.syncRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { items: true },
    });
    expect(run).toMatchObject({ entity: SyncEntity.ARTIST, mode: "REFRESH" });
    expect(run.items.map((item) => item.vocadbId)).toEqual([100]);
  });

  it("rejects unknown manual IDs before creating a run", async () => {
    await expect(
      runVocaDbArtistSync(
        { mode: "IDS", ids: [999] },
        { db, logger, client: { getArtist: async () => { throw new Error(); } } },
      ),
    ).rejects.toThrow("Unknown local artist IDs");
    expect(await db.syncRun.count()).toBe(0);
  });

  it("artist auto never resumes a running song manifest", async () => {
    await seedArtist();
    await db.syncRun.create({
      data: {
        entity: SyncEntity.SONG,
        mode: "IDS",
        discoveryCompletedAt: new Date(),
        items: { create: [{ vocadbId: 1 }] },
      },
    });
    const result = await runVocaDbArtistSync(
      { mode: "AUTO", target: "REFRESH" },
      {
        db,
        logger,
        client: {
          getArtist: async () =>
            vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
        },
      },
    );
    expect(result.successCount).toBe(1);
    expect(await db.syncRun.count({ where: { entity: SyncEntity.ARTIST } })).toBe(1);
    expect(await db.syncRun.count({ where: { entity: SyncEntity.SONG } })).toBe(1);
  });

  it("does not re-fetch a fresh profile when an older summary version differs", async () => {
    await seedArtist();
    await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        now: () => new Date("2026-07-01T00:00:00Z"),
        client: {
          getArtist: async () =>
            vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture({ version: 8 })),
        },
      },
    );

    const noRetry = vi.fn();
    await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        now: () => new Date("2026-07-02T00:00:00Z"),
        client: { getArtist: noRetry },
      },
    );
    expect(noRetry).not.toHaveBeenCalled();
  });

  it("requeues a deleted artist only after a newer song summary", async () => {
    const summaryAt = new Date("2026-07-01T00:00:00Z");
    await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture)),
      summaryAt,
    );
    const deleted = vocaDbArtistDetailSchema.parse(
      makeVocaDbArtistFixture({ deleted: true }),
    );
    await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        now: () => new Date("2026-07-02T00:00:00Z"),
        client: { getArtist: async () => deleted },
      },
    );

    const noRetry = vi.fn();
    await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        now: () => new Date("2026-07-03T00:00:00Z"),
        client: { getArtist: noRetry },
      },
    );
    expect(noRetry).not.toHaveBeenCalled();

    await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture)),
      new Date("2026-07-04T00:00:00Z"),
    );
    const restored = vi.fn().mockResolvedValue(
      vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
    );
    await runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        now: () => new Date("2026-07-05T00:00:00Z"),
        client: { getArtist: restored },
      },
    );
    expect(restored).toHaveBeenCalledWith(100, expect.anything());
    expect(await db.artist.findUniqueOrThrow({ where: { vocadbId: 100 } })).toMatchObject({
      sourceDeleted: false,
      syncStatus: SyncStatus.SYNCED,
    });
  });

  it("cancellation leaves artist item and run resumable", async () => {
    await seedArtist();
    const controller = new AbortController();
    const promise = runVocaDbArtistSync(
      { mode: "REFRESH" },
      {
        db,
        logger,
        signal: controller.signal,
        client: {
          getArtist: async () => {
            controller.abort();
            throw new VocaDbCancellationError();
          },
        },
      },
    );
    await expect(promise).rejects.toBeInstanceOf(VocaDbCancellationError);
    expect(await db.syncRun.findFirstOrThrow()).toMatchObject({
      entity: SyncEntity.ARTIST,
      status: "RUNNING",
      errorCode: "CANCELLED",
    });
    expect(await db.syncItem.findFirstOrThrow()).toMatchObject({
      status: SyncStatus.PENDING,
    });
  });
});
