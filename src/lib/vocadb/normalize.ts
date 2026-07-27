import type { VocaDbArtistDetail, VocaDbSong } from "./contract";

export type NormalizedVocaDbArtist = {
  vocadbId: number;
  name: string;
  defaultName: string;
  defaultNameLanguage: string;
  additionalNames: string[];
  description: string | null;
  artistType: string;
  sourceStatus: string;
  sourceVersion: number;
  sourceDeleted: boolean;
  sourceCreatedAt: Date;
  releaseDate: Date | null;
  mergedToVocaDbId: number | null;
  pictureMime: string | null;
  pictureUrlOriginal: string | null;
  pictureUrlThumb: string | null;
  pictureUrlSmallThumb: string | null;
  pictureUrlTinyThumb: string | null;
  names: Array<{ language: string; value: string; position: number }>;
  webLinks: Array<{
    vocadbId: number;
    url: string;
    description: string;
    category: string;
    disabled: boolean;
    position: number;
  }>;
};

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
      additionalNames: string[];
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

export function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string | null | undefined): value is string {
  return normalizeHttpUrl(value) !== null;
}

function nullableHttpUrl(value: string | null | undefined): string | null {
  return normalizeHttpUrl(value);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeVocaDbArtist(
  artist: VocaDbArtistDetail,
): NormalizedVocaDbArtist {
  const webLinks = artist.webLinks.flatMap((link) => {
    const url = normalizeHttpUrl(link.url);
    if (!url) return [];
    return [{
      vocadbId: link.id,
      url,
      description: link.description?.trim() ?? "",
      category: link.category.trim(),
      disabled: link.disabled,
    }];
  }).map((link, position) => ({ ...link, position }));

  return {
    vocadbId: artist.id,
    name: artist.name,
    defaultName: artist.defaultName,
    defaultNameLanguage: artist.defaultNameLanguage,
    additionalNames: uniqueValues(splitVocaDbFlags(artist.additionalNames)),
    description: artist.description?.trim() || null,
    artistType: artist.artistType,
    sourceStatus: artist.status,
    sourceVersion: artist.version,
    sourceDeleted: artist.deleted,
    sourceCreatedAt: parseVocaDbDate(artist.createDate)!,
    releaseDate: parseVocaDbDate(artist.releaseDate),
    mergedToVocaDbId: artist.mergedTo ?? null,
    pictureMime: artist.mainPicture?.mime?.trim() || null,
    pictureUrlOriginal: normalizeHttpUrl(artist.mainPicture?.urlOriginal),
    pictureUrlThumb: normalizeHttpUrl(artist.mainPicture?.urlThumb),
    pictureUrlSmallThumb: normalizeHttpUrl(artist.mainPicture?.urlSmallThumb),
    pictureUrlTinyThumb: normalizeHttpUrl(artist.mainPicture?.urlTinyThumb),
    names: artist.names.map((name, position) => ({ ...name, position })),
    webLinks,
  };
}

export function normalizeVocaDbSong(song: VocaDbSong): NormalizedVocaDbSong {
  const pvs = song.pvs.flatMap((pv) => {
    const url = normalizeHttpUrl(pv.url);
    if (!url) return [];
    return [{
      vocadbId: pv.id,
      externalId: pv.pvId,
      service: pv.service,
      pvType: pv.pvType,
      url,
      name: pv.name ?? null,
      author: pv.author ?? null,
      thumbnailUrl: nullableHttpUrl(pv.thumbUrl),
      publishDate: parseVocaDbDate(pv.publishDate),
      durationSeconds: pv.length ?? null,
      disabled: pv.disabled,
    }];
  }).map((pv, position) => ({ ...pv, position }));

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
            additionalNames: uniqueValues(
              splitVocaDbFlags(credit.artist.additionalNames ?? ""),
            ),
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
