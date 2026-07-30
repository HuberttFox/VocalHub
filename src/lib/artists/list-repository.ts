import { Prisma } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import type { EntityListQuery } from "@/lib/catalog/entity-list-query";
import { escapeLikePattern } from "@/lib/catalog/literal-search";
import { PUBLIC_ARTIST_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import { mapArtistAliases } from "@/lib/artists/repository";
import type { ArtistListDto, ArtistListItemDto } from "@/lib/artists/list-dto";

export type ArtistListTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "artist"
>;

export type ArtistListDb = {
  $transaction<T>(
    operation: (tx: ArtistListTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type ArtistPageRow = {
  totalItems: bigint | number;
  ids: string[];
  publicSongCounts: number[];
};

const ARTIST_LIST_SELECT = {
  id: true,
  name: true,
  additionalNames: true,
  pictureUrlOriginal: true,
  pictureUrlThumb: true,
  pictureUrlSmallThumb: true,
  pictureUrlTinyThumb: true,
  names: {
    orderBy: { position: "asc" },
    select: { language: true, value: true },
  },
} satisfies Prisma.ArtistSelect;

type ArtistListRow = Prisma.ArtistGetPayload<{ select: typeof ARTIST_LIST_SELECT }>;

export async function listArtistsInTransaction(
  query: EntityListQuery,
  tx: ArtistListTransaction,
): Promise<ArtistListDto> {
  const [page] = await tx.$queryRaw<ArtistPageRow[]>(artistPageQuery(query));
  if (!page) throw new Error("Artist query did not return pagination metadata");
  if (page.ids.length !== page.publicSongCounts.length) {
    throw new Error("Artist query returned inconsistent page arrays");
  }

  const rows = page.ids.length === 0
    ? []
    : await tx.artist.findMany({
        where: { id: { in: page.ids }, ...PUBLIC_ARTIST_WHERE },
        select: ARTIST_LIST_SELECT,
      });
  const artists = orderHydratedRows(page.ids, rows);
  const totalItems = toSafeNumber(page.totalItems, "artist totalItems");

  return {
    items: artists.map((artist, index) => mapArtistListItem(
      artist,
      page.publicSongCounts[index],
    )),
    query: { q: query.q ?? null },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}

export async function listArtists(
  query: EntityListQuery,
  database: ArtistListDb = getDb(),
): Promise<ArtistListDto> {
  return database.$transaction(
    (tx) => listArtistsInTransaction(query, tx),
    { isolationLevel: "RepeatableRead" },
  );
}

function artistPageQuery(query: EntityListQuery): Prisma.Sql {
  const search = query.q
    ? artistSearchPredicate(query.q)
    : Prisma.empty;
  const offset = (query.page - 1) * query.pageSize;

  return Prisma.sql`
    WITH "candidate" AS MATERIALIZED (
      SELECT
        artist."id",
        artist."name",
        COUNT(DISTINCT credit."songId")::integer AS "publicSongCount"
      FROM "Artist" AS artist
      JOIN "SongArtistCredit" AS credit ON credit."artistId" = artist."id"
      JOIN "Song" AS song ON song."id" = credit."songId"
      WHERE NOT artist."sourceDeleted"
        AND artist."mergedToVocaDbId" IS NULL
        AND artist."lastSyncedAt" IS NOT NULL
        AND artist."syncStatus" IN (${SyncStatus.SYNCED}, ${SyncStatus.FAILED})
        AND NOT song."sourceDeleted"
        AND song."lastSyncedAt" IS NOT NULL
        AND song."syncStatus" IN (${SyncStatus.SYNCED}, ${SyncStatus.FAILED})
        ${search}
      GROUP BY artist."id", artist."name"
    ),
    "page" AS (
      SELECT
        "id",
        "publicSongCount",
        row_number() OVER (
          ORDER BY "publicSongCount" DESC,
            lower("name") COLLATE "C" ASC,
            "id" ASC
        ) AS "position"
      FROM "candidate"
      ORDER BY "publicSongCount" DESC,
        lower("name") COLLATE "C" ASC,
        "id" ASC
      OFFSET ${offset}
      LIMIT ${query.pageSize}
    )
    SELECT
      (SELECT COUNT(*)::integer FROM "candidate") AS "totalItems",
      COALESCE(
        (SELECT array_agg("id" ORDER BY "position") FROM "page"),
        ARRAY[]::uuid[]
      ) AS "ids",
      COALESCE(
        (SELECT array_agg("publicSongCount" ORDER BY "position") FROM "page"),
        ARRAY[]::integer[]
      ) AS "publicSongCounts"
  `;
}

function artistSearchPredicate(query: string): Prisma.Sql {
  const pattern = `%${escapeLikePattern(query)}%`;
  return Prisma.sql`
    AND (
      artist."name" ILIKE ${pattern} ESCAPE '\\'
      OR artist."defaultName" ILIKE ${pattern} ESCAPE '\\'
      OR artist."additionalNames" @> ARRAY[${query}]::text[]
      OR EXISTS (
        SELECT 1 FROM "ArtistName" AS alias
        WHERE alias."artistId" = artist."id"
          AND alias."value" ILIKE ${pattern} ESCAPE '\\'
      )
    )
  `;
}

function mapArtistListItem(
  artist: ArtistListRow,
  publicSongCount: number,
): ArtistListItemDto {
  return {
    id: artist.id,
    name: artist.name,
    aliases: mapArtistAliases(artist.name, artist.names, artist.additionalNames),
    avatarUrl: artist.pictureUrlThumb
      ?? artist.pictureUrlSmallThumb
      ?? artist.pictureUrlTinyThumb
      ?? artist.pictureUrlOriginal,
    publicSongCount,
  };
}

function orderHydratedRows(ids: readonly string[], rows: ArtistListRow[]): ArtistListRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length || rows.length !== ids.length) {
    throw new Error("Artist hydration returned inconsistent rows");
  }
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Artist hydration omitted artist ${id}`);
    return row;
  });
}

function toSafeNumber(value: bigint | number, name: string): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
}
