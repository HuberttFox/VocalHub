import { Prisma } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { isUuid } from "@/lib/catalog/id";
import type { EntityListQuery } from "@/lib/catalog/entity-list-query";
import { escapeLikePattern } from "@/lib/catalog/literal-search";
import { PUBLIC_SONG_WHERE, PUBLIC_TAG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import type { TagDetailDto, TagListDto, TagListItemDto, TagSongsDto } from "@/lib/tags/dto";
import {
  buildSongListOrder,
  mapSongListItem,
  SONG_LIST_SELECT,
} from "@/lib/songs/repository";
import type { ArtistWorksQuery } from "@/lib/artists/works-query";
import { normalizeTagAliases } from "@/lib/tags/mappers";

export type TagListTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "tag" | "song"
>;

export type TagListDb = {
  $transaction<T>(
    operation: (tx: TagListTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

export type TagSongsDb = Pick<Prisma.TransactionClient, "tag" | "song">;

export type TagSongsTransactionDb = {
  $transaction<T>(
    operation: (tx: TagSongsDb) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

type TagPageRow = {
  totalItems: bigint | number;
  ids: string[];
  publicSongCounts: number[];
};

const TAG_LIST_SELECT = {
  id: true,
  name: true,
  additionalNames: true,
} satisfies Prisma.TagSelect;

type TagListRow = Prisma.TagGetPayload<{ select: typeof TAG_LIST_SELECT }>;

export async function listTagsInTransaction(
  query: EntityListQuery,
  tx: TagListTransaction,
): Promise<TagListDto> {
  const [page] = await tx.$queryRaw<TagPageRow[]>(tagPageQuery(query));
  if (!page) throw new Error("Tag query did not return pagination metadata");
  if (page.ids.length !== page.publicSongCounts.length) {
    throw new Error("Tag query returned inconsistent page arrays");
  }

  const rows = page.ids.length === 0
    ? []
    : await tx.tag.findMany({
        where: { id: { in: page.ids }, ...PUBLIC_TAG_WHERE },
        select: TAG_LIST_SELECT,
      });
  const tags = orderHydratedRows(page.ids, rows);
  const totalItems = toSafeNumber(page.totalItems, "tag totalItems");

  return {
    items: tags.map((tag, index) => mapTagListItem(tag, page.publicSongCounts[index])),
    query: { q: query.q ?? null },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    },
  };
}

export async function listTags(
  query: EntityListQuery,
  database: TagListDb = getDb(),
): Promise<TagListDto> {
  return database.$transaction(
    (tx) => listTagsInTransaction(query, tx),
    { isolationLevel: "RepeatableRead" },
  );
}

export async function getTagDetailById(
  id: string,
  database: TagListDb = getDb(),
): Promise<TagDetailDto | null> {
  if (!isUuid(id)) return null;

  return database.$transaction(async (tx) => {
    const tag = await tx.tag.findFirst({
      where: { id, ...PUBLIC_TAG_WHERE },
      select: TAG_LIST_SELECT,
    });
    if (!tag) return null;

    const publicSongCount = await tx.song.count({
      where: { ...PUBLIC_SONG_WHERE, tags: { some: { tagId: id } } },
    });
    return mapTagListItem(tag, publicSongCount);
  }, { isolationLevel: "RepeatableRead" });
}

export async function listTagSongs(
  id: string,
  query: ArtistWorksQuery,
  database: TagSongsTransactionDb = getDb(),
): Promise<TagSongsDto | null> {
  if (!isUuid(id)) return null;

  return database.$transaction(async (tx) => {
    const tag = await tx.tag.findFirst({
      where: { id, ...PUBLIC_TAG_WHERE },
      select: { id: true },
    });
    if (!tag) return null;

    const where = {
      ...PUBLIC_SONG_WHERE,
      tags: { some: { tagId: id } },
    } satisfies Prisma.SongWhereInput;
    const totalItems = await tx.song.count({ where });
    const songs = await tx.song.findMany({
      where,
      orderBy: buildSongListOrder(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: SONG_LIST_SELECT,
    });

    return {
      items: songs.map(mapSongListItem),
      query: { sort: query.sort },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }, { isolationLevel: "RepeatableRead" });
}

function tagPageQuery(query: EntityListQuery): Prisma.Sql {
  const search = query.q ? tagSearchPredicate(query.q) : Prisma.empty;
  const offset = (query.page - 1) * query.pageSize;

  return Prisma.sql`
    WITH "candidate" AS MATERIALIZED (
      SELECT
        tag."id",
        tag."name",
        COUNT(DISTINCT relation."songId")::integer AS "publicSongCount"
      FROM "Tag" AS tag
      JOIN "SongTag" AS relation ON relation."tagId" = tag."id"
      JOIN "Song" AS song ON song."id" = relation."songId"
      WHERE NOT song."sourceDeleted"
        AND song."lastSyncedAt" IS NOT NULL
        AND song."syncStatus" IN (${SyncStatus.SYNCED}, ${SyncStatus.FAILED})
        ${search}
      GROUP BY tag."id", tag."name"
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

function tagSearchPredicate(query: string): Prisma.Sql {
  const pattern = `%${escapeLikePattern(query)}%`;
  return Prisma.sql`
    AND (
      tag."name" ILIKE ${pattern} ESCAPE '\\'
      OR tag."additionalNames" @> ARRAY[${query}]::text[]
    )
  `;
}

function mapTagListItem(tag: TagListRow, publicSongCount: number): TagListItemDto {
  return {
    id: tag.id,
    name: tag.name,
    additionalNames: normalizeTagAliases(tag.additionalNames),
    publicSongCount,
  };
}

function orderHydratedRows(ids: readonly string[], rows: TagListRow[]): TagListRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length || rows.length !== ids.length) {
    throw new Error("Tag hydration returned inconsistent rows");
  }
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Tag hydration omitted tag ${id}`);
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
