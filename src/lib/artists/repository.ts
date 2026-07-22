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

  const artist = await getDb().artist.findFirst({
    where: { id, ...PUBLIC_ARTIST_WHERE },
    select: {
      id: true,
      vocadbId: true,
      name: true,
      artistType: true,
      sourceVersion: true,
      sourceUpdatedAt: true,
      lastSyncedAt: true,
    },
  });

  if (!artist) return null;

  const worksCount = await countDistinctPublicWorks(artist.id);

  return {
    id: artist.id,
    vocadbId: artist.vocadbId,
    name: artist.name,
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
  const artist = await db.artist.findFirst({
    where: { id, ...PUBLIC_ARTIST_WHERE },
    select: { id: true, name: true, artistType: true },
  });

  if (!artist) return null;

  const where = {
    ...PUBLIC_SONG_WHERE,
    artistCredits: { some: { artistId: artist.id } },
  } satisfies Prisma.SongWhereInput;

  const [totalItems, rows] = await db.$transaction(
    [
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

async function countDistinctPublicWorks(artistId: string): Promise<number> {
  return getDb().song.count({
    where: {
      ...PUBLIC_SONG_WHERE,
      artistCredits: { some: { artistId } },
    },
  });
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
