import type { Prisma } from "@/generated/prisma/client";
import {
  listArtistsInTransaction,
  type ArtistListTransaction,
} from "@/lib/artists/list-repository";
import { getDb } from "@/lib/db";
import type { SearchResultGroup, SearchResultsDto } from "@/lib/search/dto";
import { SEARCH_MAX_QUERY_LENGTH, SEARCH_PREVIEW_LIMIT } from "@/lib/search/query";
import {
  listSongsInTransaction,
  type SongListTransaction,
} from "@/lib/songs/repository";
import {
  listTagsInTransaction,
  type TagListTransaction,
} from "@/lib/tags/repository";

type SearchTransaction = SongListTransaction
  & ArtistListTransaction
  & TagListTransaction;

export type SearchDb = {
  $transaction<T>(
    operation: (tx: SearchTransaction) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<T>;
};

const SEARCH_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead",
  timeout: 15_000,
} as const;

export async function searchCatalog(
  query: string,
  database?: SearchDb,
): Promise<SearchResultsDto> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("Search query must not be blank");
  }
  if (normalizedQuery.length > SEARCH_MAX_QUERY_LENGTH) {
    throw new Error("Search query is too long");
  }
  const db = database ?? getDb();

  return db.$transaction(async (tx) => {
    const songs = await listSongsInTransaction({
      q: normalizedQuery,
      page: 1,
      pageSize: SEARCH_PREVIEW_LIMIT,
      sort: "latest",
    }, tx);
    const artists = await listArtistsInTransaction({
      q: normalizedQuery,
      page: 1,
      pageSize: SEARCH_PREVIEW_LIMIT,
    }, tx);
    const tags = await listTagsInTransaction({
      q: normalizedQuery,
      page: 1,
      pageSize: SEARCH_PREVIEW_LIMIT,
    }, tx);

    return {
      songs: toSearchResultGroup(songs.items, songs.pagination.totalItems),
      artists: toSearchResultGroup(artists.items, artists.pagination.totalItems),
      tags: toSearchResultGroup(tags.items, tags.pagination.totalItems),
    };
  }, SEARCH_TRANSACTION_OPTIONS);
}

function toSearchResultGroup<T>(
  items: T[],
  totalItems: number,
): SearchResultGroup<T> {
  return {
    items,
    totalItems,
    hasMore: totalItems > SEARCH_PREVIEW_LIMIT,
  };
}
