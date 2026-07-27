import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { vocaDbArtistDetailSchema, vocaDbSongSchema } from "@/lib/vocadb/contract";
import { normalizeVocaDbArtist, normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import {
  markArtistSyncFailure,
  syncVocaDbArtistDetail,
} from "@/lib/vocadb/sync-artist";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { makeVocaDbArtistFixture } from "../fixtures/vocadb/artist";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => db.$connect());
beforeEach(async () => {
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

describe("artist detail persistence", () => {
  it("updates an existing artist idempotently and preserves its UUID", async () => {
    const initial = await seedArtist();
    await db.artist.update({
      where: { vocadbId: 100 },
      data: { sourceUpdatedAt: new Date("2026-07-20T00:00:00Z") },
    });
    const detail = normalizeVocaDbArtist(
      vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
    );
    await syncVocaDbArtistDetail(db, detail, new Date("2026-07-28T01:00:00Z"));
    await syncVocaDbArtistDetail(db, detail, new Date("2026-07-28T02:00:00Z"));

    const artist = await db.artist.findUniqueOrThrow({
      where: { vocadbId: 100 },
      include: { names: true, webLinks: true },
    });
    expect(artist).toMatchObject({
      id: initial.id,
      description: "Independent artist description.\nSecond line.",
      detailLastSyncedAt: new Date("2026-07-28T02:00:00Z"),
      sourceUpdatedAt: new Date("2026-07-20T00:00:00Z"),
      syncStatus: SyncStatus.SYNCED,
    });
    expect(artist.names).toHaveLength(2);
    expect(artist.webLinks).toHaveLength(2);
  });

  it("preserves last-good details across failure and later song summaries", async () => {
    await seedArtist();
    await syncVocaDbArtistDetail(
      db,
      normalizeVocaDbArtist(vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture())),
      new Date("2026-07-28T01:00:00Z"),
    );
    await markArtistSyncFailure(
      db,
      100,
      SyncStatus.FAILED,
      "network exhausted",
      new Date("2026-07-28T02:00:00Z"),
    );
    const changedSong = structuredClone(vocaDbSongFixture) as unknown as {
      artists: Array<{
        artist: {
          name: string;
          version: number;
        };
      }>;
    } & Omit<typeof vocaDbSongFixture, "artists">;
    changedSong.artists[0].artist.name = "Embedded rename";
    changedSong.artists[0].artist.version = 99;
    await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(changedSong)),
      new Date("2026-07-28T03:00:00Z"),
    );

    const artist = await db.artist.findUniqueOrThrow({ where: { vocadbId: 100 } });
    expect(artist).toMatchObject({
      name: "Producer",
      sourceVersion: 8,
      syncStatus: SyncStatus.FAILED,
      summaryName: "Embedded rename",
      summarySourceVersion: 99,
      description: "Independent artist description.\nSecond line.",
    });
  });

  it("refuses to ingest unknown artists", async () => {
    await expect(
      syncVocaDbArtistDetail(
        db,
        normalizeVocaDbArtist(
          vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture({ id: 999 })),
        ),
      ),
    ).rejects.toThrow("does not exist");
    expect(await db.artist.count()).toBe(0);
  });
});
