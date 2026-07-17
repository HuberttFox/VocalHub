import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { GET } from "@/app/api/songs/[id]/route";
import { normalizeVocaDbSong } from "@/lib/vocadb/normalize";
import { syncVocaDbSong } from "@/lib/vocadb/sync-song";
import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import { vocaDbSongFixture } from "../fixtures/vocadb/song";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vocalhub:vocalhub@localhost:5432/vocalhub_test";
process.env.DATABASE_URL = connectionString;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await db.songPV.deleteMany();
  await db.songTag.deleteMany();
  await db.tag.deleteMany();
  await db.songArtistCredit.deleteMany();
  await db.artist.deleteMany();
  await db.songName.deleteMany();
  await db.song.deleteMany();
});

function requestSong(id: string) {
  return GET(new Request(`http://localhost/api/songs/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/songs/[id]", () => {
  it("rejects non-UUID identifiers", async () => {
    const response = await requestSong(String(vocaDbSongFixture.id));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_SONG_ID" },
    });
  });

  it("returns 404 for an unknown local UUID", async () => {
    const response = await requestSong("11111111-1111-4111-8111-111111111111");
    expect(response.status).toBe(404);
  });

  it("returns a stable local DTO for a synced song", async () => {
    const result = await syncVocaDbSong(
      db,
      normalizeVocaDbSong(vocaDbSongSchema.parse(vocaDbSongFixture)),
    );
    const response = await requestSong(result.id);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: result.id,
      vocadbId: vocaDbSongFixture.id,
      title: vocaDbSongFixture.name,
      source: { provider: "VocaDB" },
    });
    expect(payload).not.toHaveProperty("syncStatus");
  });
});
