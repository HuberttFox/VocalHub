import type { VocaDbSong } from "./contract";

export type NormalizedVocaDbSong = {
  vocadbId: number;
  name: string;
  defaultName: string;
  defaultNameLanguage: string;
  artistString: string;
  songType: string;
  sourceStatus: string;
  sourceDeleted: boolean;
  sourceCreatedAt: Date;
  publishDate: Date | null;
  durationSeconds: number;
  favoritedTimes: number;
  ratingScore: number;
  originalVersionId: number | null;
  cultureCodes: string[];
  coverUrlOriginal: string | null;
  coverUrlThumb: string | null;
  sourceVersion: number;
  sourceUpdatedAt: Date | null;
  names: Array<{ language: string; value: string; position: number }>;
  artistCredits: Array<{
    vocadbId: number;
    name: string;
    categories: string[];
    roles: string[];
    effectiveRoles: string[];
    isSupport: boolean;
    isCustomName: boolean;
    position: number;
    artist: {
      vocadbId: number;
      name: string;
      artistType: string;
      sourceStatus: string;
      sourceVersion: number;
      sourceDeleted: boolean;
      sourceUpdatedAt: Date | null;
    } | null;
  }>;
  tags: Array<{
    vocadbId: number;
    name: string;
    additionalNames: string[];
    categoryName: string | null;
    urlSlug: string | null;
    count: number;
    position: number;
  }>;
  pvs: Array<{
    vocadbId: number;
    externalId: string;
    service: string;
    pvType: string;
    url: string;
    name: string | null;
    author: string | null;
    thumbnailUrl: string | null;
    publishDate: Date | null;
    durationSeconds: number | null;
    disabled: boolean;
    position: number;
  }>;
};

export function splitVocaDbFlags(value: string): string[] {
  return value
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);
}

export function parseVocaDbDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  // VocaDB serializes some UTC values without a zone. Treat those as UTC
  // rather than allowing their meaning to depend on the worker's timezone.
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid VocaDB date: ${value}`);
  }

  return date;
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableHttpUrl(value: string | null | undefined): string | null {
  return isHttpUrl(value) ? value : null;
}

export function normalizeVocaDbSong(song: VocaDbSong): NormalizedVocaDbSong {
  const pvs = song.pvs
    .filter((pv) => isHttpUrl(pv.url))
    .map((pv, position) => ({
      vocadbId: pv.id,
      externalId: pv.pvId,
      service: pv.service,
      pvType: pv.pvType,
      url: pv.url,
      name: pv.name ?? null,
      author: pv.author ?? null,
      thumbnailUrl: nullableHttpUrl(pv.thumbUrl),
      publishDate: parseVocaDbDate(pv.publishDate),
      durationSeconds: pv.length ?? null,
      disabled: pv.disabled,
      position,
    }));

  return {
    vocadbId: song.id,
    name: song.name,
    defaultName: song.defaultName,
    defaultNameLanguage: song.defaultNameLanguage,
    artistString: song.artistString,
    songType: song.songType,
    sourceStatus: song.status,
    sourceDeleted: song.deleted,
    sourceCreatedAt: parseVocaDbDate(song.createDate)!,
    publishDate: parseVocaDbDate(song.publishDate),
    durationSeconds: song.lengthSeconds,
    favoritedTimes: song.favoritedTimes,
    ratingScore: song.ratingScore,
    originalVersionId: song.originalVersionId ?? null,
    cultureCodes: [...song.cultureCodes],
    coverUrlOriginal: nullableHttpUrl(song.mainPicture?.urlOriginal),
    coverUrlThumb: nullableHttpUrl(song.mainPicture?.urlThumb),
    sourceVersion: song.version,
    sourceUpdatedAt: parseVocaDbDate(song.updateDate),
    names: song.names.map((entry, position) => ({ ...entry, position })),
    artistCredits: song.artists.map((credit, position) => ({
      vocadbId: credit.id,
      name: credit.name ?? credit.artist?.name ?? "",
      categories: splitVocaDbFlags(credit.categories),
      roles: splitVocaDbFlags(credit.roles),
      effectiveRoles: splitVocaDbFlags(credit.effectiveRoles),
      isSupport: credit.isSupport,
      isCustomName: credit.isCustomName,
      position,
      artist: credit.artist
        ? {
            vocadbId: credit.artist.id,
            name: credit.artist.name,
            artistType: credit.artist.artistType,
            sourceStatus: credit.artist.status,
            sourceVersion: credit.artist.version,
            sourceDeleted: credit.artist.deleted,
            sourceUpdatedAt: null,
          }
        : null,
    })),
    tags: song.tags.map(({ count, tag }, position) => ({
      vocadbId: tag.id,
      name: tag.name,
      additionalNames: tag.additionalNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      categoryName: tag.categoryName ?? null,
      urlSlug: tag.urlSlug ?? null,
      count,
      position,
    })),
    pvs,
  };
}

export type NormalizedVocaDBSong = NormalizedVocaDbSong;
export const normalizeVocaDBSong = normalizeVocaDbSong;
