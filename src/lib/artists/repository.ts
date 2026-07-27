import type { Prisma } from "@/generated/prisma/client";
import { isUuid } from "@/lib/catalog/id";
import { PUBLIC_ARTIST_WHERE, PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { ArtistDetailDto, ArtistWorksDto } from "@/lib/artists/dto";
import type { ArtistWorksQuery } from "@/lib/artists/works-query";
import {
  buildSongListOrder,
  mapSongListItem,
  SONG_LIST_SELECT,
} from "@/lib/songs/repository";

const ARTIST_WORK_SELECT = {
  ...SONG_LIST_SELECT,
  artistCredits: {
    orderBy: { position: "asc" },
    select: {
      name: true,
      artistId: true,
      categories: true,
      roles: true,
      effectiveRoles: true,
      isSupport: true,
      isCustomName: true,
    },
  },
} satisfies Prisma.SongSelect;

type ArtistWorkRow = Prisma.SongGetPayload<{ select: typeof ARTIST_WORK_SELECT }>;

export type ArtistWorksDb = Pick<ReturnType<typeof getDb>, "$transaction" | "artist" | "song">;

export async function getArtistDetailById(
  id: string,
): Promise<ArtistDetailDto | null> {
  if (!isUuid(id)) return null;

  const db = getDb();
  const [artist, worksCount] = await db.$transaction(
    [
      db.artist.findFirst({
        where: { id, ...PUBLIC_ARTIST_WHERE },
        select: {
          id: true,
          vocadbId: true,
          name: true,
          defaultName: true,
          defaultNameLanguage: true,
          additionalNames: true,
          description: true,
          artistType: true,
          pictureUrlOriginal: true,
          pictureUrlThumb: true,
          pictureUrlSmallThumb: true,
          pictureUrlTinyThumb: true,
          pictureMime: true,
          names: {
            orderBy: { position: "asc" },
            select: { language: true, value: true },
          },
          webLinks: {
            where: { disabled: false },
            orderBy: { position: "asc" },
            select: {
              id: true,
              url: true,
              description: true,
              category: true,
            },
          },
          sourceVersion: true,
          sourceUpdatedAt: true,
          lastSyncedAt: true,
        },
      }),
      db.song.count({
        where: {
          ...PUBLIC_SONG_WHERE,
          artistCredits: { some: { artistId: id } },
        },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  if (!artist) return null;

  return {
    id: artist.id,
    vocadbId: artist.vocadbId,
    name: artist.name,
    defaultName: artist.defaultName,
    defaultNameLanguage: artist.defaultNameLanguage,
    description: artist.description,
    aliases: mapArtistAliases(
      artist.name,
      artist.names,
      artist.additionalNames,
    ),
    avatar: mapArtistAvatar(artist),
    webLinks: artist.webLinks,
    artistType: artist.artistType,
    worksCount,
    source: {
      provider: "VocaDB",
      url: `https://vocadb.net/Ar/${artist.vocadbId}`,
      version: artist.sourceVersion,
      sourceUpdatedAt: artist.sourceUpdatedAt?.toISOString() ?? null,
      lastSyncedAt: artist.lastSyncedAt?.toISOString() ?? null,
    },
  };
}

export async function listArtistWorks(
  id: string,
  query: ArtistWorksQuery,
  database?: ArtistWorksDb,
): Promise<ArtistWorksDto | null> {
  if (!isUuid(id)) return null;

  const db = database ?? getDb();
  const where = {
    ...PUBLIC_SONG_WHERE,
    artistCredits: { some: { artistId: id } },
  } satisfies Prisma.SongWhereInput;

  const [artist, totalItems, rows] = await db.$transaction(
    [
      db.artist.findFirst({
        where: { id, ...PUBLIC_ARTIST_WHERE },
        select: { id: true, name: true, artistType: true },
      }),
      db.song.count({ where }),
      db.song.findMany({
        where,
        orderBy: buildSongListOrder(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ARTIST_WORK_SELECT,
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  if (!artist) return null;

  return {
    artist,
    items: rows.map((row) => mapArtistWork(row, artist.id)),
    query: { sort: query.sort },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}

function mapArtistAliases(
  name: string,
  localized: Array<{ language: string; value: string }>,
  additional: string[],
) {
  const seen = new Set([name]);
  const aliases: Array<{ language: string | null; value: string }> = [];
  for (const alias of [
    ...localized.map((entry) => ({ language: entry.language, value: entry.value })),
    ...additional.map((value) => ({ language: null, value })),
  ]) {
    const value = alias.value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    aliases.push({ ...alias, value });
  }
  return aliases;
}

function mapArtistAvatar(artist: {
  pictureUrlOriginal: string | null;
  pictureUrlThumb: string | null;
  pictureUrlSmallThumb: string | null;
  pictureUrlTinyThumb: string | null;
  pictureMime: string | null;
}) {
  const avatar = {
    urlOriginal: artist.pictureUrlOriginal,
    urlThumb: artist.pictureUrlThumb,
    urlSmallThumb: artist.pictureUrlSmallThumb,
    urlTinyThumb: artist.pictureUrlTinyThumb,
    mime: artist.pictureMime,
  };
  return Object.values(avatar).some(Boolean) ? avatar : null;
}

function mapArtistWork(row: ArtistWorkRow, artistId: string) {
  return {
    ...mapSongListItem(row),
    artistCredits: row.artistCredits
      .filter((credit) => credit.artistId === artistId)
      .map((credit) => ({
        name: credit.name,
        categories: credit.categories,
        roles: credit.roles,
        effectiveRoles: credit.effectiveRoles,
        isSupport: credit.isSupport,
        isCustomName: credit.isCustomName,
      })),
  };
}
