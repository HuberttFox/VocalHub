import "dotenv/config";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { searchCatalog } from "@/lib/search/repository";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { makeVocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL
  ?? "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
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

type SongFixture = {
  id: number;
  name: string;
  defaultName: string;
  names: Array<{ language: string; value: string }>;
  artistString: string;
  artists: Array<{
    name: string;
    artist: { name: string } | null;
  }>;
  tags: Array<{ tag: { name: string } }>;
};

async function seedSong(
  id: number,
  update: (fixture: SongFixture) => void,
) {
  const fixture = makeVocaDbSongFixture() as unknown as SongFixture
    & Record<string, unknown>;
  fixture.id = id;
  update(fixture);
  return syncVocaDbSong(
    db,
    normalizeVocaDbSong(vocaDbSongSchema.parse(fixture)),
  );
}

describe("searchCatalog", () => {
  it("returns matching songs, artists, and tags with accurate totals", async () => {
    const first = await seedSong(1_001, (fixture) => {
      fixture.name = "Nebula Song One";
      fixture.defaultName = "Nebula Song One";
      fixture.names = [{ language: "English", value: "Nebula Song One" }];
      fixture.artistString = "Nebula Producer";
      fixture.artists[0].name = "Nebula Producer";
      fixture.artists[0].artist!.name = "Nebula Producer";
      fixture.tags[0].tag.name = "Nebula Genre";
    });
    const second = await seedSong(1_002, (fixture) => {
      fixture.name = "Nebula Song Two";
      fixture.defaultName = "Nebula Song Two";
      fixture.names = [{ language: "English", value: "Nebula Song Two" }];
      fixture.artistString = "Nebula Producer";
      fixture.artists[0].name = "Nebula Producer";
      fixture.artists[0].artist!.name = "Nebula Producer";
      fixture.tags[0].tag.name = "Nebula Genre";
    });

    const result = await searchCatalog("nebula", db);

    expect(result.songs.items.map((item) => item.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(result.songs).toMatchObject({ totalItems: 2, hasMore: false });
    expect(result.artists.items.map((item) => item.name)).toEqual([
      "Nebula Producer",
    ]);
    expect(result.artists).toMatchObject({ totalItems: 1, hasMore: false });
    expect(result.tags.items.map((item) => item.name)).toEqual(["Nebula Genre"]);
    expect(result.tags).toMatchObject({ totalItems: 1, hasMore: false });
  });

  it("matches a custom credit only in the song group", async () => {
    const song = await seedSong(2_001, (fixture) => {
      fixture.name = "Unrelated Song";
      fixture.defaultName = "Unrelated Song";
      fixture.names = [{ language: "English", value: "Unrelated Song" }];
      fixture.artists[1].name = "Solo Needle";
    });

    const result = await searchCatalog("Solo Needle", db);

    expect(result.songs.items.map((item) => item.id)).toEqual([song.id]);
    expect(result.songs.totalItems).toBe(1);
    expect(result.artists).toEqual({ items: [], totalItems: 0, hasMore: false });
    expect(result.tags).toEqual({ items: [], totalItems: 0, hasMore: false });
  });

  it.each([
    [6, false],
    [7, true],
  ])("caps a %i-song preview at six and derives hasMore", async (count, hasMore) => {
    for (let index = 0; index < count; index += 1) {
      await seedSong(3_000 + index, (fixture) => {
        const title = `Boundary Song ${index}`;
        fixture.name = title;
        fixture.defaultName = title;
        fixture.names = [{ language: "English", value: title }];
      });
    }

    const result = await searchCatalog("boundary", db);

    expect(result.songs.items).toHaveLength(Math.min(count, 6));
    expect(result.songs.totalItems).toBe(count);
    expect(result.songs.hasMore).toBe(hasMore);
    expect(result.artists.items).toEqual([]);
    expect(result.tags.items).toEqual([]);
  });
});
