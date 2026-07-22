import { createHash } from "node:crypto";
import { SyncStatus } from "@/generated/prisma/enums";
import {
  CATALOG_BENCHMARK_DATASET_VERSION,
  CATALOG_BENCHMARK_MAX_SONGS,
  CATALOG_BENCHMARK_MIN_SONGS,
  type CatalogBenchmarkChunkOptions,
  type CatalogBenchmarkDataset,
  type CatalogBenchmarkDatasetOptions,
  type CatalogBenchmarkMarker,
  type CatalogBenchmarkRelations,
  type CatalogBenchmarkVisibilityCounts,
} from "./types";

const ARTIST_SONG_RATIO = 8;
const TAG_SONG_RATIO = 100;
const MIN_ARTISTS = 625;
const MIN_TAGS = 80;
const BASE_DATE_MS = Date.UTC(2010, 0, 1);
const DAY_MS = 86_400_000;
const HIDDEN_CASES = 5;
const HIGH_FANOUT_INDEX = 0;
const MEDIUM_FANOUT_INDEX = 1;
const SPARSE_FANOUT_INDEX = 2;
const DUPLICATE_CREDIT_INDEX = 3;
const HIGH_FANOUT_DIVISOR = 10;
const MEDIUM_FANOUT_DIVISOR = 50;
const RARE_TAG_INDEX = 0;
const MEDIUM_TAG_INDEX = 1;

const SEARCH_TERMS = {
  rareTitle: "BenchRareTitleZXQ",
  mediumDefaultTitle: "BenchMediumDefaultQKM",
  cjkAlternateName: "星屑ベンチ検索",
  commonArtistString: "BenchCommonArtistNVR",
  literalCredit: "Bench%Literal_Credit",
  linkedArtistName: "BenchLinkedArtistRVT",
  rareTagName: "BenchRareTagPLX",
  mediumTagAlias: "BenchMediumAliasWQZ",
  noHit: "BenchNoHitZZZ999",
} as const;

const titleWords = [
  "Starlight", "Digital", "Echo", "Future", "Neon", "Melody", "Sky", "Dream",
  "Signal", "Memory", "Moon", "Bloom", "Circuit", "Crystal", "Gravity", "Voice",
] as const;
const suffixWords = [
  "Parade", "Theory", "Canvas", "Journey", "Refrain", "Archive", "Garden", "Protocol",
] as const;
const artistTypes = ["Producer", "Vocalist", "Band", "Circle", "Illustrator"] as const;
const tagCategories = ["Genre", "Subject", "Mood", "Vocalists", "Other"] as const;
const songTypes = ["Original", "Remaster", "Cover", "Remix"] as const;
const languages = ["English", "Japanese", "Romaji"] as const;

export function assertCatalogBenchmarkDatasetOptions(
  options: CatalogBenchmarkDatasetOptions,
): void {
  if (
    !Number.isSafeInteger(options.songCount) ||
    options.songCount < CATALOG_BENCHMARK_MIN_SONGS ||
    options.songCount > CATALOG_BENCHMARK_MAX_SONGS
  ) {
    throw new Error(
      `songCount must be an integer between ${CATALOG_BENCHMARK_MIN_SONGS} and ${CATALOG_BENCHMARK_MAX_SONGS}`,
    );
  }
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new Error("seed must be a non-negative safe integer");
  }
}

export function generateCatalogBenchmarkDataset(
  options: CatalogBenchmarkDatasetOptions,
): CatalogBenchmarkDataset {
  assertCatalogBenchmarkDatasetOptions(options);
  const marker = createCatalogBenchmarkMarker(options);
  const chunk = generateCatalogBenchmarkChunk({
    ...options,
    start: 0,
    count: options.songCount,
  });
  return {
    artists: generateCatalogBenchmarkArtists(options),
    tags: generateCatalogBenchmarkTags(options),
    ...chunk,
    marker,
  };
}

export function generateCatalogBenchmarkArtists(
  options: CatalogBenchmarkDatasetOptions,
): CatalogBenchmarkDataset["artists"] {
  assertCatalogBenchmarkDatasetOptions(options);
  return Array.from({ length: artistCount(options.songCount) }, (_, index) => {
    const number = index + 1;
    const updatedAt = dateFor(options.seed, index, 17);
    return {
      id: stableUuid("artist", number, options.seed),
      vocadbId: 2_000_000 + number,
      name: index === HIGH_FANOUT_INDEX
        ? SEARCH_TERMS.linkedArtistName
        : `Synthetic Artist ${number.toString().padStart(4, "0")}`,
      artistType: artistTypes[randomInt(options.seed, index, 3, artistTypes.length)],
      sourceStatus: "Finished",
      sourceVersion: 1 + randomInt(options.seed, index, 5, 12),
      sourceDeleted: false,
      sourceUpdatedAt: updatedAt,
      lastSyncedAt: updatedAt,
      syncStatus: SyncStatus.SYNCED,
      createdAt: updatedAt,
      updatedAt,
    };
  });
}

export function generateCatalogBenchmarkTags(
  options: CatalogBenchmarkDatasetOptions,
): CatalogBenchmarkDataset["tags"] {
  assertCatalogBenchmarkDatasetOptions(options);
  return Array.from({ length: tagCount(options.songCount) }, (_, index) => {
    const number = index + 1;
    return {
      id: stableUuid("tag", number, options.seed),
      vocadbId: 3_000_000 + number,
      name: index === RARE_TAG_INDEX
        ? SEARCH_TERMS.rareTagName
        : `Synthetic Tag ${number.toString().padStart(3, "0")}`,
      additionalNames: index === MEDIUM_TAG_INDEX
        ? [SEARCH_TERMS.mediumTagAlias, `alias-${number}`]
        : [`tag-${number}`, `alias-${number}`],
      categoryName: tagCategories[index % tagCategories.length],
      urlSlug: `synthetic-tag-${number}`,
      lastSyncedAt: dateFor(options.seed, index, 23),
    };
  });
}

export function generateCatalogBenchmarkChunk(
  options: CatalogBenchmarkChunkOptions,
): CatalogBenchmarkRelations {
  assertCatalogBenchmarkDatasetOptions(options);
  if (
    !Number.isSafeInteger(options.start) ||
    !Number.isSafeInteger(options.count) ||
    options.start < 0 ||
    options.count < 0 ||
    options.start + options.count > options.songCount
  ) {
    throw new Error("chunk range must be within the requested songCount");
  }

  const result: CatalogBenchmarkRelations = { songs: [], names: [], credits: [], songTags: [] };
  const artists = artistCount(options.songCount);
  const tags = tagCount(options.songCount);

  for (let index = options.start; index < options.start + options.count; index += 1) {
    const number = index + 1;
    const songId = stableUuid("song", number, options.seed);
    const publishedAt = dateFor(options.seed, index, 31);
    const baseTitle = `${pick(titleWords, options.seed, index, 37)} ${pick(suffixWords, options.seed, index, 41)} ${number}`;
    const title = index === HIDDEN_CASES + 1 ? `${SEARCH_TERMS.rareTitle} ${baseTitle}` : baseTitle;
    const defaultName = isMediumMarker(index)
      ? `${SEARCH_TERMS.mediumDefaultTitle} ${baseTitle}`
      : title;
    const primaryArtistIndex = primaryArtistFor(index, options.seed, artists);
    const secondaryArtistIndex = secondaryArtistFor(
      index,
      primaryArtistIndex,
      options.seed,
      artists,
    );
    const hasCustomCredit = index === HIDDEN_CASES + 1 || randomInt(options.seed, index, 53, 10) === 0;
    const status = visibilityFor(index);
    const artistPrefix = isCommonMarker(index) ? `${SEARCH_TERMS.commonArtistString}, ` : "";

    result.songs.push({
      id: songId,
      vocadbId: 1_000_000 + number,
      name: title,
      defaultName,
      defaultNameLanguage: "English",
      artistString: `${artistPrefix}Synthetic Artist ${primaryArtistIndex + 1}, ${hasCustomCredit ? `Guest Vocalist ${number}` : `Synthetic Artist ${secondaryArtistIndex + 1}`}`,
      songType: songTypes[randomInt(options.seed, index, 59, songTypes.length)],
      sourceStatus: "Finished",
      sourceDeleted: status.sourceDeleted,
      sourceCreatedAt: new Date(publishedAt.getTime() - 30 * DAY_MS),
      publishDate: publishedAt,
      durationSeconds: 120 + randomInt(options.seed, index, 61, 301),
      favoritedTimes: randomInt(options.seed, index, 67, 20_000),
      ratingScore: randomInt(options.seed, index, 71, 10_000),
      originalVersionId: number % 19 === 0 ? 1_000_000 + Math.max(1, number - 1) : null,
      cultureCodes: number % 4 === 0 ? ["ja", "en"] : ["ja"],
      coverUrlOriginal: `https://example.invalid/benchmark/covers/${number}.jpg`,
      coverUrlThumb: `https://example.invalid/benchmark/covers/${number}-thumb.jpg`,
      sourceVersion: 1 + randomInt(options.seed, index, 73, 20),
      sourceUpdatedAt: publishedAt,
      lastSyncedAt: status.lastSyncedAt ? publishedAt : null,
      syncStatus: status.syncStatus,
      lastSyncError: status.syncStatus === SyncStatus.FAILED ? "synthetic refresh failure" : null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
    });

    const nameCount = 2 + randomInt(options.seed, index, 79, 2);
    for (let position = 0; position < nameCount; position += 1) {
      result.names.push({
        id: stableUuid("song-name", number * 10 + position, options.seed),
        songId,
        language: languages[position],
        value: index === HIDDEN_CASES + 2 && position === 1
          ? `${SEARCH_TERMS.cjkAlternateName} ${number}`
          : position === 0 ? title : `${title} ${languages[position]}`,
        position,
      });
    }

    result.credits.push(
      creditRow(options.seed, number, songId, 0, primaryArtistIndex, false),
      creditRow(
        options.seed,
        number,
        songId,
        1,
        hasCustomCredit ? null : secondaryArtistIndex,
        index === HIDDEN_CASES + 1,
      ),
    );
    if (primaryArtistIndex === DUPLICATE_CREDIT_INDEX && index % 2 === 0) {
      result.credits.push(
        creditRow(options.seed, number, songId, 2, DUPLICATE_CREDIT_INDEX, false),
      );
    }

    const relationCount = 3 + randomInt(options.seed, index, 83, 4);
    const relationTags = relationTagIndexes(index, options.songCount, options.seed, tags, relationCount);
    relationTags.forEach((tagIndex, position) => {
      result.songTags.push({
        songId,
        tagId: stableUuid("tag", tagIndex + 1, options.seed),
        count: 1 + randomInt(options.seed, index, 101 + position, 25),
        position,
      });
    });
  }

  return result;
}

export function createCatalogBenchmarkMarker(
  options: CatalogBenchmarkDatasetOptions,
): CatalogBenchmarkMarker {
  assertCatalogBenchmarkDatasetOptions(options);
  const highFanout = artistMarker(options, HIGH_FANOUT_INDEX);
  const markerWithoutChecksum = {
    kind: "vocalhub-catalog-benchmark" as const,
    version: CATALOG_BENCHMARK_DATASET_VERSION,
    seed: options.seed,
    songCount: options.songCount,
    artistCount: artistCount(options.songCount),
    tagCount: tagCount(options.songCount),
    nameCount: expectedNameCount(options),
    creditCount: expectedCreditCount(options),
    songTagCount: expectedSongTagCount(options),
    visibility: visibilityCounts(options.songCount),
    searchMarkers: {
      rareTitle: searchMarker(SEARCH_TERMS.rareTitle, "name", 1),
      mediumDefaultTitle: searchMarker(SEARCH_TERMS.mediumDefaultTitle, "defaultName", mediumCount(options.songCount)),
      cjkAlternateName: searchMarker(SEARCH_TERMS.cjkAlternateName, "names.value", 1),
      commonArtistString: searchMarker(SEARCH_TERMS.commonArtistString, "artistString", commonCount(options.songCount)),
      literalCredit: searchMarker(SEARCH_TERMS.literalCredit, "artistCredits.name", 1),
      linkedArtistName: searchMarker(
        SEARCH_TERMS.linkedArtistName,
        "artistCredits.artist.name",
        highFanout.expectedPublicSongCount,
      ),
      rareTagName: searchMarker(SEARCH_TERMS.rareTagName, "tags.name", 1),
      mediumTagAlias: searchMarker(SEARCH_TERMS.mediumTagAlias, "tags.additionalNames", mediumTagCount(options.songCount)),
      noHit: searchMarker(SEARCH_TERMS.noHit, "none", 0),
    },
    artistMarkers: {
      highFanout,
      mediumFanout: artistMarker(options, MEDIUM_FANOUT_INDEX),
      sparseFanout: artistMarker(options, SPARSE_FANOUT_INDEX),
      duplicateCredits: artistMarker(options, DUPLICATE_CREDIT_INDEX),
    },
  };
  return {
    ...markerWithoutChecksum,
    checksum: createHash("sha256")
      .update(JSON.stringify(markerWithoutChecksum))
      .digest("hex"),
  };
}

function searchMarker(
  term: string,
  branch: CatalogBenchmarkMarker["searchMarkers"][keyof CatalogBenchmarkMarker["searchMarkers"]]["branch"],
  expectedPublicSongCount: number,
) {
  return { term, branch, expectedPublicSongCount };
}

function artistMarker(options: CatalogBenchmarkDatasetOptions, artistIndex: number) {
  let expectedPublicSongCount = 0;
  let expectedCreditCount = 0;
  const artists = artistCount(options.songCount);
  for (let index = 0; index < options.songCount; index += 1) {
    if (!isPublicIndex(index)) continue;
    const primary = primaryArtistFor(index, options.seed, artists);
    const secondary = secondaryArtistFor(index, primary, options.seed, artists);
    if (primary === artistIndex || secondary === artistIndex) {
      expectedPublicSongCount += 1;
      expectedCreditCount += Number(primary === artistIndex) + Number(secondary === artistIndex);
      if (
        artistIndex === DUPLICATE_CREDIT_INDEX &&
        primary === artistIndex &&
        index % 2 === 0
      ) {
        expectedCreditCount += 1;
      }
    }
  }
  return {
    artistId: stableUuid("artist", artistIndex + 1, options.seed),
    expectedPublicSongCount,
    expectedCreditCount,
  };
}

function creditRow(
  seed: number,
  songNumber: number,
  songId: string,
  position: number,
  artistIndex: number | null,
  literalMarker: boolean,
): CatalogBenchmarkRelations["credits"][number] {
  const custom = artistIndex === null;
  return {
    id: stableUuid("credit", songNumber * 10 + position, seed),
    vocadbId: songNumber * 10 + position + 1,
    songId,
    artistId: custom ? null : stableUuid("artist", artistIndex + 1, seed),
    name: literalMarker
      ? SEARCH_TERMS.literalCredit
      : custom ? `Guest Vocalist ${songNumber}` : `Synthetic Artist ${artistIndex + 1}`,
    categories: position === 0 ? ["Producer"] : ["Vocalist"],
    roles: position === 0 ? ["Composer", "Lyricist"] : ["Vocals"],
    effectiveRoles: position === 0 ? ["Composer", "Lyricist"] : ["Vocals"],
    isSupport: position > 0 && songNumber % 7 === 0,
    isCustomName: custom,
    position,
  };
}

function primaryArtistFor(
  index: number,
  seed: number,
  artists: number,
): number {
  if (index % HIGH_FANOUT_DIVISOR === 0) return HIGH_FANOUT_INDEX;
  if (index % MEDIUM_FANOUT_DIVISOR === 1) return MEDIUM_FANOUT_INDEX;
  if (index === HIDDEN_CASES + 3) return SPARSE_FANOUT_INDEX;
  if (index % 97 === 3) return DUPLICATE_CREDIT_INDEX;
  return 4 + randomInt(seed, index, 43, artists - 4);
}

function secondaryArtistFor(
  index: number,
  primaryArtistIndex: number,
  seed: number,
  artists: number,
): number {
  let secondary = (
    primaryArtistIndex + 1 + randomInt(seed, index, 47, artists - 1)
  ) % artists;
  const reserved = new Set([
    HIGH_FANOUT_INDEX,
    MEDIUM_FANOUT_INDEX,
    SPARSE_FANOUT_INDEX,
    DUPLICATE_CREDIT_INDEX,
  ]);
  while (reserved.has(secondary)) {
    secondary = 4 + ((secondary - 3) % (artists - 4));
  }
  return secondary;
}

function relationTagIndexes(
  index: number,
  songCount: number,
  seed: number,
  tags: number,
  count: number,
): number[] {
  const forced = index === HIDDEN_CASES + 4
    ? [RARE_TAG_INDEX]
    : isMediumTagMarker(index, songCount) ? [MEDIUM_TAG_INDEX] : [];
  const used = new Set(forced);
  let candidate = 2 + randomInt(seed, index, 89, tags - 2);
  const step = coprimeStep(
    1 + randomInt(seed, index, 97, tags - 3),
    tags - 2,
  );
  while (used.size < count) {
    used.add(candidate);
    candidate = 2 + ((candidate - 2 + step) % (tags - 2));
  }
  return [...used];
}

function coprimeStep(candidate: number, modulus: number): number {
  let step = candidate;
  while (greatestCommonDivisor(step, modulus) !== 1) {
    step = (step % (modulus - 1)) + 1;
  }
  return step;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function visibilityFor(index: number): {
  syncStatus: (typeof SyncStatus)[keyof typeof SyncStatus];
  sourceDeleted: boolean;
  lastSyncedAt: boolean;
} {
  if (index === 0) return { syncStatus: SyncStatus.FAILED, sourceDeleted: false, lastSyncedAt: true };
  if (index === 1) return { syncStatus: SyncStatus.PENDING, sourceDeleted: false, lastSyncedAt: true };
  if (index === 2) return { syncStatus: SyncStatus.SOURCE_MISSING, sourceDeleted: false, lastSyncedAt: true };
  if (index === 3) return { syncStatus: SyncStatus.SOURCE_DELETED, sourceDeleted: false, lastSyncedAt: true };
  if (index === 4) return { syncStatus: SyncStatus.SYNCED, sourceDeleted: true, lastSyncedAt: true };
  if (index === 5) return { syncStatus: SyncStatus.SYNCED, sourceDeleted: false, lastSyncedAt: false };
  return { syncStatus: SyncStatus.SYNCED, sourceDeleted: false, lastSyncedAt: true };
}

function visibilityCounts(songCount: number): CatalogBenchmarkVisibilityCounts {
  return {
    publicSynced: songCount - 6,
    publicFailed: 1,
    hiddenPending: 1,
    hiddenSourceMissing: 1,
    hiddenSourceDeletedStatus: 1,
    hiddenSourceDeletedFlag: 1,
    hiddenLastSyncedAtNull: 1,
  };
}

function isPublicIndex(index: number): boolean {
  return index === 0 || index >= 6;
}

function isMediumMarker(index: number): boolean {
  return index >= 6 && index % 100 === 6;
}

function isCommonMarker(index: number): boolean {
  return index >= 6 && index % 5 === 1;
}

function isMediumTagMarker(index: number, songCount: number): boolean {
  return index >= 6 && index < songCount && index % 100 === 7;
}

function mediumCount(songCount: number): number {
  let count = 0;
  for (let index = 6; index < songCount; index += 1) if (isMediumMarker(index)) count += 1;
  return count;
}

function commonCount(songCount: number): number {
  let count = 0;
  for (let index = 6; index < songCount; index += 1) if (isCommonMarker(index)) count += 1;
  return count;
}

function mediumTagCount(songCount: number): number {
  let count = 0;
  for (let index = 6; index < songCount; index += 1) if (isMediumTagMarker(index, songCount)) count += 1;
  return count;
}

function expectedNameCount(options: CatalogBenchmarkDatasetOptions): number {
  let total = 0;
  for (let index = 0; index < options.songCount; index += 1) {
    total += 2 + randomInt(options.seed, index, 79, 2);
  }
  return total;
}

function expectedCreditCount(options: CatalogBenchmarkDatasetOptions): number {
  let total = options.songCount * 2;
  const artists = artistCount(options.songCount);
  for (let index = 0; index < options.songCount; index += 1) {
    if (primaryArtistFor(index, options.seed, artists) === DUPLICATE_CREDIT_INDEX && index % 2 === 0) total += 1;
  }
  return total;
}

function expectedSongTagCount(options: CatalogBenchmarkDatasetOptions): number {
  let total = 0;
  for (let index = 0; index < options.songCount; index += 1) {
    total += 3 + randomInt(options.seed, index, 83, 4);
  }
  return total;
}

function artistCount(songCount: number): number {
  return Math.max(MIN_ARTISTS, Math.ceil(songCount / ARTIST_SONG_RATIO));
}

function tagCount(songCount: number): number {
  return Math.max(MIN_TAGS, Math.ceil(songCount / TAG_SONG_RATIO));
}

function dateFor(seed: number, index: number, salt: number): Date {
  const day = randomInt(seed, index, salt, 5_840);
  const second = randomInt(seed, index, salt + 1, 86_400);
  return new Date(BASE_DATE_MS + day * DAY_MS + second * 1_000);
}

function pick<T>(values: readonly T[], seed: number, index: number, salt: number): T {
  return values[randomInt(seed, index, salt, values.length)];
}

function randomInt(seed: number, index: number, salt: number, maximum: number): number {
  if (maximum <= 1) return 0;
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) % maximum;
}

function stableUuid(kind: string, number: number, seed: number): string {
  const hex = createHash("sha256")
    .update(`${CATALOG_BENCHMARK_DATASET_VERSION}:${seed}:${kind}:${number}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
