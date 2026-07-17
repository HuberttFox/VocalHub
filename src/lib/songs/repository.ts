import { getDb } from "@/lib/db";
import type { SongDetailDto } from "@/lib/songs/dto";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function getSongDetailById(
  id: string,
): Promise<SongDetailDto | null> {
  if (!isUuid(id)) {
    return null;
  }

  const song = await getDb().song.findUnique({
    where: { id },
    include: {
      names: { orderBy: { position: "asc" } },
      artistCredits: {
        orderBy: { position: "asc" },
        include: { artist: true },
      },
      tags: {
        orderBy: { position: "asc" },
        include: { tag: true },
      },
      pvs: { orderBy: { position: "asc" } },
    },
  });

  if (!song) {
    return null;
  }

  return {
    id: song.id,
    vocadbId: song.vocadbId,
    title: song.name,
    defaultTitle: song.defaultName,
    defaultNameLanguage: song.defaultNameLanguage,
    names: song.names.map(({ language, value }) => ({ language, value })),
    artistString: song.artistString,
    credits: song.artistCredits.map((credit) => ({
      name: credit.name,
      categories: credit.categories,
      roles: credit.roles,
      effectiveRoles: credit.effectiveRoles,
      isSupport: credit.isSupport,
      isCustomName: credit.isCustomName,
      artist: credit.artist
        ? {
            id: credit.artist.id,
            vocadbId: credit.artist.vocadbId,
            name: credit.artist.name,
            artistType: credit.artist.artistType,
          }
        : null,
    })),
    tags: song.tags.map(({ count, tag }) => ({
      id: tag.id,
      vocadbId: tag.vocadbId,
      name: tag.name,
      additionalNames: tag.additionalNames,
      categoryName: tag.categoryName,
      urlSlug: tag.urlSlug,
      count,
    })),
    pvs: song.pvs.map((pv) => ({
      id: pv.id,
      vocadbId: pv.vocadbId,
      externalId: pv.externalId,
      service: pv.service,
      pvType: pv.pvType,
      url: pv.url,
      name: pv.name,
      author: pv.author,
      publishDate: pv.publishDate?.toISOString() ?? null,
      durationSeconds: pv.durationSeconds,
    })),
    songType: song.songType,
    publishDate: song.publishDate?.toISOString() ?? null,
    durationSeconds: song.durationSeconds,
    favoritedTimes: song.favoritedTimes,
    ratingScore: song.ratingScore,
    source: {
      provider: "VocaDB",
      url: `https://vocadb.net/S/${song.vocadbId}`,
      version: song.sourceVersion,
      sourceUpdatedAt: song.sourceUpdatedAt?.toISOString() ?? null,
      lastSyncedAt: song.lastSyncedAt?.toISOString() ?? null,
      deleted: song.sourceDeleted,
    },
  };
}
