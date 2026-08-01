import { Prisma } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { escapeLikePattern } from "@/lib/catalog/literal-search";
import type { SongListDto } from "@/lib/songs/dto";
import type { SongListQuery } from "@/lib/songs/list-query";
import {
  SONG_LIST_SELECT,
  mapSongListItem,
  type SongListDb,
  type SongListTransaction,
} from "@/lib/songs/repository";

type SongListRow = Prisma.SongGetPayload<{ select: typeof SONG_LIST_SELECT }>;

type SearchPageRow = {
  totalItems: bigint | number;
  ids: string[];
};

const PUBLIC_STATUSES = [SyncStatus.SYNCED, SyncStatus.FAILED] as const;

export async function listSongsWithDecomposedSearch(
  query: SongListQuery,
  db: SongListDb,
): Promise<SongListDto> {
  const literalQuery = query.q;
  if (!literalQuery) {
    throw new Error("Decomposed search requires a query");
  }

  return db.$transaction(
    (tx) => listSongsWithDecomposedSearchInTransaction(query, tx),
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );
}

export async function listSongsWithDecomposedSearchInTransaction(
  query: SongListQuery,
  tx: SongListTransaction,
): Promise<SongListDto> {
  const literalQuery = query.q;
  if (!literalQuery) {
    throw new Error("Decomposed search requires a query");
  }

  const [page] = await tx.$queryRaw<SearchPageRow[]>(searchPageQuery(query, literalQuery));
  if (!page) throw new Error("Search query did not return pagination metadata");

  const rows = page.ids.length === 0
    ? []
    : await tx.song.findMany({
        where: { id: { in: page.ids }, ...PUBLIC_SONG_WHERE },
        select: SONG_LIST_SELECT,
      });
  const songs = orderHydratedRows(page.ids, rows);
  const totalItems = toSafeNumber(page.totalItems, "search totalItems");

  return {
    items: songs.map(mapSongListItem),
    query: { q: literalQuery, sort: query.sort },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}

function searchPageQuery(query: SongListQuery, literalQuery: string): Prisma.Sql {
  const pattern = `%${escapeLikePattern(literalQuery)}%`;
  const offset = (query.page - 1) * query.pageSize;
  const order = query.sort === "popular"
    ? Prisma.sql`"favoritedTimes" DESC, "ratingScore" DESC, "publishDate" DESC NULLS LAST, "id" ASC`
    : Prisma.sql`"publishDate" DESC NULLS LAST, "sourceCreatedAt" DESC, "id" ASC`;

  return Prisma.sql`
    WITH "matched" AS MATERIALIZED (
      SELECT "id" AS "songId"
      FROM "Song"
      WHERE "name" ILIKE ${pattern} ESCAPE '\\'
         OR "defaultName" ILIKE ${pattern} ESCAPE '\\'
         OR "artistString" ILIKE ${pattern} ESCAPE '\\'
      UNION
      SELECT "songId"
      FROM "SongName"
      WHERE "value" ILIKE ${pattern} ESCAPE '\\'
      UNION
      SELECT "songId"
      FROM "SongArtistCredit"
      WHERE "name" ILIKE ${pattern} ESCAPE '\\'
      UNION
      SELECT credit."songId"
      FROM "SongArtistCredit" AS credit
      JOIN "Artist" AS artist ON artist."id" = credit."artistId"
      WHERE artist."name" ILIKE ${pattern} ESCAPE '\\'
      UNION
      SELECT relation."songId"
      FROM "SongTag" AS relation
      JOIN "Tag" AS tag ON tag."id" = relation."tagId"
      WHERE tag."name" ILIKE ${pattern} ESCAPE '\\'
      UNION
      SELECT relation."songId"
      FROM "SongTag" AS relation
      JOIN "Tag" AS tag ON tag."id" = relation."tagId"
      WHERE tag."additionalNames" @> ARRAY[${literalQuery}]::text[]
    ),
    "visible" AS MATERIALIZED (
      SELECT song."id", song."publishDate", song."sourceCreatedAt",
             song."favoritedTimes", song."ratingScore"
      FROM "matched"
      JOIN "Song" AS song ON song."id" = "matched"."songId"
      WHERE NOT song."sourceDeleted"
        AND song."lastSyncedAt" IS NOT NULL
        AND song."syncStatus" IN (${Prisma.join(PUBLIC_STATUSES)})
    ),
    "page" AS (
      SELECT "id", row_number() OVER (ORDER BY ${order}) AS "position"
      FROM "visible"
      ORDER BY ${order}
      OFFSET ${offset}
      LIMIT ${query.pageSize}
    )
    SELECT
      (SELECT COUNT(*) FROM "visible") AS "totalItems",
      COALESCE((SELECT array_agg("id" ORDER BY "position") FROM "page"),
               ARRAY[]::uuid[]) AS "ids"
  `;
}

function orderHydratedRows(ids: readonly string[], rows: SongListRow[]): SongListRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length || rows.length !== ids.length) {
    throw new Error("Search hydration returned inconsistent rows");
  }
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Search hydration omitted song ${id}`);
    return row;
  });
}

function toSafeNumber(value: bigint | number, name: string): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} is invalid`);
  return parsed;
}
