import { describe, expect, it } from "vitest";
import {
  createCatalogBenchmarkMarker,
  generateCatalogBenchmarkChunk,
  generateCatalogBenchmarkDataset,
} from "../../benchmarks/catalog/dataset";

const options = { songCount: 5_000, seed: 20_260_720 };

describe("catalog benchmark dataset", () => {
  it("generates deterministic, schema-shaped catalog relations", () => {
    const first = generateCatalogBenchmarkDataset(options);
    const second = generateCatalogBenchmarkDataset(options);

    expect(first).toEqual(second);
    expect(first.songs).toHaveLength(5_000);
    expect(first.artists).toHaveLength(625);
    expect(first.tags).toHaveLength(80);
    expect(first.names).toHaveLength(first.marker.nameCount);
    expect(first.credits).toHaveLength(first.marker.creditCount);
    expect(first.songTags).toHaveLength(first.marker.songTagCount);

    expect(first.songs[6]).toMatchObject({
      vocadbId: 1_000_007,
      sourceStatus: "Finished",
      sourceDeleted: false,
      syncStatus: "SYNCED",
    });
    expect(first.songs[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.names[0].songId).toBe(first.songs[0].id);
    expect(first.credits[0].songId).toBe(first.songs[0].id);
    expect(first.songTags[0].songId).toBe(first.songs[0].id);
    expect(first.tags.some((tag) => tag.id === first.songTags[0].tagId)).toBe(true);
  });

  it("is stateless and independent of chunk boundaries", () => {
    const whole = generateCatalogBenchmarkChunk({
      ...options,
      start: 0,
      count: options.songCount,
    });
    const pieces = [
      generateCatalogBenchmarkChunk({ ...options, start: 0, count: 777 }),
      generateCatalogBenchmarkChunk({ ...options, start: 777, count: 2_001 }),
      generateCatalogBenchmarkChunk({ ...options, start: 2_778, count: 2_222 }),
    ];

    expect(pieces.flatMap((piece) => piece.songs)).toEqual(whole.songs);
    expect(pieces.flatMap((piece) => piece.names)).toEqual(whole.names);
    expect(pieces.flatMap((piece) => piece.credits)).toEqual(whole.credits);
    expect(pieces.flatMap((piece) => piece.songTags)).toEqual(whole.songTags);
  });

  it("emits a versioned full-cardinality marker", () => {
    const base = generateCatalogBenchmarkDataset(options);
    const otherSeed = generateCatalogBenchmarkDataset({ ...options, seed: options.seed + 1 });

    expect(otherSeed.songs[0].id).not.toBe(base.songs[0].id);
    expect(otherSeed.marker.checksum).not.toBe(base.marker.checksum);
    expect(createCatalogBenchmarkMarker({ songCount: 10_000, seed: options.seed }).checksum)
      .not.toBe(base.marker.checksum);
    expect(base.marker).toMatchObject({
      kind: "vocalhub-catalog-benchmark",
      version: 3,
      seed: options.seed,
      songCount: 5_000,
      artistCount: 625,
      tagCount: 80,
      nameCount: base.names.length,
      creditCount: base.credits.length,
      songTagCount: base.songTags.length,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("covers public FAILED and every hidden visibility branch", () => {
    const dataset = generateCatalogBenchmarkDataset(options);
    const songs = dataset.songs;
    expect(dataset.marker.visibility).toEqual({
      publicSynced: 4_994,
      publicFailed: 1,
      hiddenPending: 1,
      hiddenSourceMissing: 1,
      hiddenSourceDeletedStatus: 1,
      hiddenSourceDeletedFlag: 1,
      hiddenLastSyncedAtNull: 1,
    });
    expect(songs[0]).toMatchObject({ syncStatus: "FAILED", sourceDeleted: false });
    expect(songs[0].lastSyncedAt).not.toBeNull();
    expect(songs[1].syncStatus).toBe("PENDING");
    expect(songs[2].syncStatus).toBe("SOURCE_MISSING");
    expect(songs[3].syncStatus).toBe("SOURCE_DELETED");
    expect(songs[4].sourceDeleted).toBe(true);
    expect(songs[5].lastSyncedAt).toBeNull();
  });

  it("documents rare, medium, common, no-hit, CJK, and literal search markers", () => {
    const dataset = generateCatalogBenchmarkDataset(options);
    const markers = dataset.marker.searchMarkers;
    expect(Object.values(markers).map(({ branch }) => branch)).toEqual([
      "name",
      "defaultName",
      "names.value",
      "artistString",
      "artistCredits.name",
      "artistCredits.artist.name",
      "tags.name",
      "tags.additionalNames",
      "none",
    ]);
    expect(markers.rareTitle.expectedPublicSongCount).toBe(1);
    expect(markers.mediumDefaultTitle.expectedPublicSongCount).toBeGreaterThan(1);
    expect(markers.commonArtistString.expectedPublicSongCount)
      .toBeGreaterThan(markers.mediumDefaultTitle.expectedPublicSongCount);
    expect(markers.cjkAlternateName.term).toMatch(/[^\x00-\x7F]/);
    expect(markers.literalCredit.term).toMatch(/[%_]/);
    expect(markers.linkedArtistName.expectedPublicSongCount)
      .toBe(dataset.marker.artistMarkers.highFanout.expectedPublicSongCount);
    expect(markers.noHit.expectedPublicSongCount).toBe(0);

    expect(dataset.songs.filter((song) => song.name.includes(markers.rareTitle.term))).toHaveLength(1);
    expect(dataset.names.filter((name) => name.value.includes(markers.cjkAlternateName.term))).toHaveLength(1);
    expect(dataset.credits.filter((credit) => credit.name === markers.literalCredit.term)).toHaveLength(1);
    expect(dataset.artists.filter((artist) => artist.name === markers.linkedArtistName.term)).toHaveLength(1);
    expect(dataset.tags.filter((tag) => tag.name === markers.rareTagName.term)).toHaveLength(1);
  });

  it("provides high, medium, sparse, and duplicate-credit artist marker IDs", () => {
    const dataset = generateCatalogBenchmarkDataset(options);
    const markers = dataset.marker.artistMarkers;
    expect(new Set(Object.values(markers).map(({ artistId }) => artistId)).size).toBe(4);
    expect(markers.highFanout.expectedPublicSongCount)
      .toBeGreaterThan(markers.mediumFanout.expectedPublicSongCount);
    expect(markers.mediumFanout.expectedPublicSongCount)
      .toBeGreaterThan(markers.sparseFanout.expectedPublicSongCount);
    expect(markers.sparseFanout.expectedPublicSongCount).toBe(1);
    expect(markers.duplicateCredits.expectedCreditCount)
      .toBeGreaterThan(markers.duplicateCredits.expectedPublicSongCount);
    expect(dataset.artists.map(({ id }) => id)).toEqual(expect.arrayContaining(
      Object.values(markers).map(({ artistId }) => artistId),
    ));
  });

  it("includes structured and custom credits plus varied searchable data", () => {
    const dataset = generateCatalogBenchmarkDataset(options);
    expect(dataset.credits.some((credit) => credit.artistId !== null)).toBe(true);
    expect(dataset.credits.some((credit) => credit.artistId === null && credit.isCustomName)).toBe(true);
    expect(new Set(dataset.songs.map((song) => song.songType)).size).toBeGreaterThan(1);
    expect(dataset.tags.every(
      (tag) => Array.isArray(tag.additionalNames) && tag.additionalNames.length > 0,
    )).toBe(true);
    expect(dataset.names.some((name) => name.language === "Japanese")).toBe(true);
  });

  it.each([
    { songCount: 4_999, seed: 1 },
    { songCount: 20_001, seed: 1 },
    { songCount: 5_000.5, seed: 1 },
    { songCount: 5_000, seed: -1 },
  ])("rejects unsupported options %#", (invalid) => {
    expect(() => generateCatalogBenchmarkDataset(invalid)).toThrow();
  });

  it("rejects chunks outside the requested scale", () => {
    expect(() =>
      generateCatalogBenchmarkChunk({ ...options, start: 4_999, count: 2 }),
    ).toThrow("chunk range");
  });
});
