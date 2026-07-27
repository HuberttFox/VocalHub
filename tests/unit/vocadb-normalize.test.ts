import { describe, expect, it } from "vitest";

import {
  vocaDbArtistDetailSchema,
  vocaDbSongSchema,
} from "@/lib/vocadb/contract";
import {
  normalizeHttpUrl,
  normalizeVocaDbArtist,
  normalizeVocaDbSong,
  parseVocaDbDate,
  splitVocaDbFlags,
} from "@/lib/vocadb/normalize";
import { makeVocaDbArtistFixture } from "../fixtures/vocadb/artist";
import { makeVocaDbSongFixture } from "../fixtures/vocadb/song";

describe("normalizeVocaDbArtist", () => {
  it("normalizes complete detail and retains disabled links", () => {
    const normalized = normalizeVocaDbArtist(
      vocaDbArtistDetailSchema.parse(makeVocaDbArtistFixture()),
    );
    expect(normalized).toMatchObject({
      additionalNames: ["Producer Alias", "制作者"],
      description: "Independent artist description.\nSecond line.",
      sourceCreatedAt: new Date("2020-01-02T03:04:05Z"),
      pictureUrlOriginal: "https://example.test/artist.png",
    });
    expect(normalized.names.map((name) => name.position)).toEqual([0, 1]);
    expect(normalized.webLinks).toEqual([
      expect.objectContaining({ vocadbId: 500, disabled: false, position: 0 }),
      expect.objectContaining({ vocadbId: 501, disabled: true, position: 1 }),
    ]);
  });

  it("removes unsafe URLs, credentials, and empty descriptions", () => {
    const payload = makeVocaDbArtistFixture({
      description: "  ",
      mainPicture: {
        urlOriginal: "https://user:pass@example.test/avatar.png",
        urlThumb: "javascript:alert(1)",
        urlTinyThumb: " http://example.test/tiny.png ",
      },
      webLinks: [
        { id: 1, url: "data:text/plain,no", description: "bad", category: "Other" },
        { id: 2, url: "https://example.test/ok", description: "ok", category: "Official" },
      ],
    });
    const normalized = normalizeVocaDbArtist(vocaDbArtistDetailSchema.parse(payload));
    expect(normalized.description).toBeNull();
    expect(normalized.pictureUrlOriginal).toBeNull();
    expect(normalized.pictureUrlThumb).toBeNull();
    expect(normalized.pictureUrlTinyThumb).toBe("http://example.test/tiny.png");
    expect(normalized.webLinks).toEqual([
      expect.objectContaining({ vocadbId: 2, position: 0 }),
    ]);
    expect(normalizeHttpUrl("https://user:pass@example.test/")).toBeNull();
  });
});

describe("normalizeVocaDbSong", () => {
  it("normalizes comma-separated flags and positional relations", () => {
    const normalized = normalizeVocaDbSong(
      vocaDbSongSchema.parse(makeVocaDbSongFixture()),
    );

    expect(normalized.artistCredits[0]).toMatchObject({
      categories: ["Producer", "Animator"],
      roles: ["Composer", "Arranger"],
      effectiveRoles: ["Composer", "Arranger"],
      position: 0,
    });
    expect(normalized.names[1].position).toBe(1);
    expect(normalized.tags[0]).toMatchObject({
      additionalNames: ["electronic", "synth"],
      position: 0,
    });
  });

  it("preserves a custom artist credit without an artist relation", () => {
    const normalized = normalizeVocaDbSong(
      vocaDbSongSchema.parse(makeVocaDbSongFixture()),
    );

    expect(normalized.artistCredits[1]).toMatchObject({
      name: "Custom chorus",
      isCustomName: true,
      isSupport: true,
      artist: null,
    });
  });

  it("treats dates without timezones as UTC", () => {
    expect(parseVocaDbDate("2026-07-01T12:30:00")?.toISOString()).toBe(
      "2026-07-01T12:30:00.000Z",
    );
    expect(parseVocaDbDate("2026-07-01T12:30:00+09:00")?.toISOString()).toBe(
      "2026-07-01T03:30:00.000Z",
    );
  });

  it("keeps HTTP(S) media and nulls unsafe image URLs", () => {
    const fixture = makeVocaDbSongFixture();
    const payload = {
      ...fixture,
      mainPicture: {
        urlOriginal: "javascript:alert(1)",
        urlThumb: "https://example.test/cover-thumb.jpg",
      },
      pvs: [
        {
          ...fixture.pvs[0],
          thumbUrl: "data:image/png;base64,unsafe",
        },
      ],
    };
    const normalized = normalizeVocaDbSong(vocaDbSongSchema.parse(payload));

    expect(normalized.coverUrlOriginal).toBeNull();
    expect(normalized.coverUrlThumb).toBe(
      "https://example.test/cover-thumb.jpg",
    );
    expect(normalized.pvs).toHaveLength(1);
    expect(normalized.pvs[0].thumbnailUrl).toBeNull();
  });

  it("keeps only HTTP(S) PV URLs and compacts positions", () => {
    const fixture = makeVocaDbSongFixture();
    const payload = {
      ...fixture,
      pvs: [
        ...fixture.pvs,
        {
          ...fixture.pvs[0],
          id: 201,
          pvId: "unsafe",
          url: "javascript:alert(1)",
        },
        {
          ...fixture.pvs[0],
          id: 202,
          pvId: "http-video",
          url: "http://example.test/watch/http-video",
        },
      ],
    };
    const normalized = normalizeVocaDbSong(vocaDbSongSchema.parse(payload));

    expect(normalized.pvs.map(({ vocadbId, position }) => ({ vocadbId, position }))).toEqual([
      { vocadbId: 200, position: 0 },
      { vocadbId: 202, position: 1 },
    ]);
  });

  it("uses null when the source has no updateDate", () => {
    const payload = makeVocaDbSongFixture();
    const normalized = normalizeVocaDbSong(vocaDbSongSchema.parse(payload));

    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  it("normalizes updateDate when present", () => {
    const payload = { ...makeVocaDbSongFixture(), updateDate: "2026-07-17T08:00:00" };
    const normalized = normalizeVocaDbSong(vocaDbSongSchema.parse(payload));

    expect(normalized.sourceUpdatedAt?.toISOString()).toBe(
      "2026-07-17T08:00:00.000Z",
    );
  });

  it("drops empty flag segments", () => {
    expect(splitVocaDbFlags("Default, , VoiceManipulator,")).toEqual([
      "Default",
      "VoiceManipulator",
    ]);
  });
});
