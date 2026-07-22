import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await db.syncItem.deleteMany();
  await db.syncRun.deleteMany();
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

describe("syncVocaDbSong", () => {
  it("keeps local UUID and relation counts stable across repeated syncs", async () => {
    const input = normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture));
    const first = await syncVocaDbSong(db, input, new Date("2026-01-01T00:00:00Z"));
    const second = await syncVocaDbSong(db, input, new Date("2026-01-02T00:00:00Z"));

    expect(second.id).toBe(first.id);
    expect(await db.song.count()).toBe(1);
    expect(await db.artist.count()).toBe(input.artistCredits.filter((credit) => credit.artist).length);
    expect(await db.songArtistCredit.count()).toBe(input.artistCredits.length);
    expect(await db.tag.count()).toBe(input.tags.length);
    expect(await db.songTag.count()).toBe(input.tags.length);
    expect(await db.songPV.count()).toBe(input.pvs.length);

    const song = await db.song.findUniqueOrThrow({ where: { id: first.id } });
    expect(song.lastSyncedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("updates fields and removes stale song relations", async () => {
    const input = normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture));
    const first = await syncVocaDbSong(db, input);
    const changed = {
      ...input,
      name: "Updated title",
      sourceVersion: input.sourceVersion + 1,
      tags: input.tags.slice(0, 1),
      pvs: [],
      artistCredits: input.artistCredits.slice(0, 1),
    };

    await syncVocaDbSong(db, changed);

    expect(
      await db.song.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ name: "Updated title", sourceVersion: changed.sourceVersion });
    expect(await db.songTag.count({ where: { songId: first.id } })).toBe(1);
    expect(await db.songPV.count({ where: { songId: first.id } })).toBe(0);
    expect(await db.songArtistCredit.count({ where: { songId: first.id } })).toBe(1);
  });

  it("clears all relations when complete source collections are empty", async () => {
    const input = normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture));
    const first = await syncVocaDbSong(db, input);

    await syncVocaDbSong(db, {
      ...input,
      artistCredits: [],
      tags: [],
      pvs: [],
    });

    expect(await db.songArtistCredit.count({ where: { songId: first.id } })).toBe(0);
    expect(await db.songTag.count({ where: { songId: first.id } })).toBe(0);
    expect(await db.songPV.count({ where: { songId: first.id } })).toBe(0);
  });
});
