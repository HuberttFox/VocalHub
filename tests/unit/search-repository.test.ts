import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listSongsInTransaction,
  listArtistsInTransaction,
  listTagsInTransaction,
} = vi.hoisted(() => ({
  listSongsInTransaction: vi.fn(),
  listArtistsInTransaction: vi.fn(),
  listTagsInTransaction: vi.fn(),
}));

vi.mock("@/lib/songs/repository", () => ({
  listSongsInTransaction,
}));
vi.mock("@/lib/artists/list-repository", () => ({
  listArtistsInTransaction,
}));
vi.mock("@/lib/tags/repository", () => ({
  listTagsInTransaction,
}));

import { searchCatalog, type SearchDb } from "@/lib/search/repository";

const songItems = [{ id: "song-1", title: "Search Song" }];
const artistItems = [{ id: "artist-1", name: "Search Artist" }];
const tagItems = [{ id: "tag-1", name: "Search Tag" }];

beforeEach(() => {
  vi.clearAllMocks();
  listSongsInTransaction.mockResolvedValue({
    items: songItems,
    pagination: { totalItems: 7 },
  });
  listArtistsInTransaction.mockResolvedValue({
    items: artistItems,
    pagination: { totalItems: 6 },
  });
  listTagsInTransaction.mockResolvedValue({
    items: tagItems,
    pagination: { totalItems: 2 },
  });
});

describe("searchCatalog", () => {
  it("runs all previews sequentially in one repeatable-read transaction", async () => {
    const tx = { marker: "same transaction" };
    const transaction = vi.fn(async (operation, options) => {
      expect(options).toEqual({
        isolationLevel: "RepeatableRead",
        timeout: 15_000,
      });
      return operation(tx);
    });
    const database = { $transaction: transaction } as unknown as SearchDb;

    const result = await searchCatalog("miku", database);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(listSongsInTransaction).toHaveBeenNthCalledWith(1, {
      q: "miku",
      page: 1,
      pageSize: 6,
      sort: "latest",
    }, tx);
    expect(listArtistsInTransaction).toHaveBeenNthCalledWith(1, {
      q: "miku",
      page: 1,
      pageSize: 6,
    }, tx);
    expect(listTagsInTransaction).toHaveBeenNthCalledWith(1, {
      q: "miku",
      page: 1,
      pageSize: 6,
    }, tx);
    expect(listSongsInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      listArtistsInTransaction.mock.invocationCallOrder[0],
    );
    expect(listArtistsInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      listTagsInTransaction.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      songs: { items: songItems, totalItems: 7, hasMore: true },
      artists: { items: artistItems, totalItems: 6, hasMore: false },
      tags: { items: tagItems, totalItems: 2, hasMore: false },
    });
  });

  it("normalizes direct input before running previews", async () => {
    const tx = { marker: "same transaction" };
    const database = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as SearchDb;

    await searchCatalog("  miku  ", database);

    expect(listSongsInTransaction).toHaveBeenCalledWith(expect.objectContaining({ q: "miku" }), tx);
    expect(listArtistsInTransaction).toHaveBeenCalledWith(expect.objectContaining({ q: "miku" }), tx);
    expect(listTagsInTransaction).toHaveBeenCalledWith(expect.objectContaining({ q: "miku" }), tx);
  });

  it("rejects overlong direct input without opening a transaction", async () => {
    const transaction = vi.fn();
    const database = { $transaction: transaction } as unknown as SearchDb;

    await expect(searchCatalog("x".repeat(101), database)).rejects.toThrow(
      "Search query is too long",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

});
