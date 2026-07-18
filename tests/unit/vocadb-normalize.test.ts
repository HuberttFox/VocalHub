import { describe, expect, it } from "vitest";

import { vocaDbSongSchema } from "@/lib/vocadb/contract";
import {
  normalizeVocaDbSong,
  parseVocaDbDate,
  splitVocaDbFlags,
} from "@/lib/vocadb/normalize";
import { makeVocaDbSongFixture } from "../fixtures/vocadb/song";

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
