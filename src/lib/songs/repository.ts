import type { Prisma } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import type { SongDetailDto, SongListDto } from "@/lib/songs/dto";
import type { SongListQuery } from "@/lib/songs/list-query";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_SONG_WHERE = {
  sourceDeleted: false,
  lastSyncedAt: { not: null },
  syncStatus: { in: [SyncStatus.SYNCED, SyncStatus.FAILED] },
} satisfies Prisma.SongWhereInput;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function listSongs(query: SongListQuery): Promise<SongListDto> {
  const db = getDb();
  const where = buildSongListWhere(query.q);
  const orderBy = buildSongListOrder(query.sort);
  const skip = (query.page - 1) * query.pageSize;

  const [totalItems, songs] = await db.$transaction(
    [
      db.song.count({ where }),
      db.song.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          artistString: true,
          songType: true,
          publishDate: true,
          durationSeconds: true,
          favoritedTimes: true,
          ratingScore: true,
          names: {
            orderBy: { position: "asc" },
            select: { language: true, value: true },
          },
          artistCredits: {
            orderBy: { position: "asc" },
            select: {
              name: true,
              artistId: true,
              isSupport: true,
              isCustomName: true,
            },
          },
          tags: {
            orderBy: { position: "asc" },
            select: { tag: { select: { id: true, name: true } } },
          },
        },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  return {
    items: songs.map((song) => ({
      id: song.id,
      title: song.name,
      names: song.names,
      artistString: song.artistString,
      credits: song.artistCredits,
      tags: song.tags.map(({ tag }) => tag),
      songType: song.songType,
      publishDate: song.publishDate?.toISOString() ?? null,
      durationSeconds: song.durationSeconds,
      favoritedTimes: song.favoritedTimes,
      ratingScore: song.ratingScore,
    })),
    query: { q: query.q ?? null, sort: query.sort },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}

export async function getSongDetailById(
  id: string,
): Promise<SongDetailDto | null> {
  if (!isUuid(id)) {
    return null;
  }

  const song = await getDb().song.findFirst({
    where: { id, ...PUBLIC_SONG_WHERE },
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

function buildSongListWhere(query: string | undefined): Prisma.SongWhereInput {
  if (!query) {
    return PUBLIC_SONG_WHERE;
  }

  const contains = {
    contains: escapeLikePattern(query),
    mode: "insensitive" as const,
  };

  return {
    ...PUBLIC_SONG_WHERE,
    OR: [
      { name: contains },
      { defaultName: contains },
      { artistString: contains },
      { names: { some: { value: contains } } },
      {
        artistCredits: {
          some: {
            OR: [
              { name: contains },
              { artist: { is: { name: contains } } },
            ],
          },
        },
      },
      {
        tags: {
          some: {
            tag: {
              is: {
                OR: [
                  { name: contains },
                  { additionalNames: { has: query } },
                ],
              },
            },
          },
        },
      },
    ],
  };
}

function buildSongListOrder(
  sort: SongListQuery["sort"],
): Prisma.SongOrderByWithRelationInput[] {
  if (sort === "popular") {
    return [
      { favoritedTimes: "desc" },
      { ratingScore: "desc" },
      { publishDate: { sort: "desc", nulls: "last" } },
      { id: "asc" },
    ];
  }

  return [
    { publishDate: { sort: "desc", nulls: "last" } },
    { sourceCreatedAt: "desc" },
    { id: "asc" },
  ];
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
