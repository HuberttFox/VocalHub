import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/search/query", () => ({
  SEARCH_MAX_QUERY_LENGTH: 100,
  SEARCH_PREVIEW_LIMIT: 6,
  parseSearchQuery: (params: Record<string, string | string[] | undefined>) => {
    const value = params.q;
    if (Array.isArray(value) || (typeof value === "string" && value.trim().length > 100)) {
      return { success: false } as const;
    }
    const q = value?.trim();
    return { success: true, data: q ? { q } : {} } as const;
  },
}));

vi.mock("@/lib/search/repository", () => ({
  searchCatalog: vi.fn(),
}));

import SearchPage, { searchViewAllHref } from "@/app/search/page";
import { searchCatalog } from "@/lib/search/repository";

const mockedSearchCatalog = vi.mocked(searchCatalog);
const emptyResults = {
  songs: { items: [], totalItems: 0, hasMore: false },
  artists: { items: [], totalItems: 0, hasMore: false },
  tags: { items: [], totalItems: 0, hasMore: false },
};

const song = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Reserved Song",
  names: [{ language: "Japanese", value: "予約曲" }],
  artistString: "Producer",
  credits: [],
  tags: [{ id: "00000000-0000-4000-8000-000000000003", name: "Synthpop" }],
  coverUrlOriginal: null,
  coverUrlThumb: null,
  songType: "Original",
  publishDate: "2026-07-31",
  durationSeconds: 180,
  favoritedTimes: 12,
  ratingScore: 4,
};
const artist = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Producer",
  aliases: [{ language: "Japanese", value: "作曲家" }],
  avatarUrl: null,
  publicSongCount: 8,
};
const tag = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Synthpop",
  additionalNames: ["电子流行"],
  publicSongCount: 5,
};

async function render(params: Record<string, string | string[] | undefined>) {
  return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve(params) }));
}

describe("SearchPage", () => {
  beforeEach(() => {
    mockedSearchCatalog.mockReset();
    mockedSearchCatalog.mockResolvedValue(emptyResults);
  });

  it.each([{}, { q: "   " }])("renders the idle form without searching for %o", async (params) => {
    const markup = await render(params);

    expect(mockedSearchCatalog).not.toHaveBeenCalled();
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="q"');
    expect(markup).toContain('maxLength="100"');
    expect(markup).toContain("输入关键词开始搜索");
    expect(markup).not.toContain("查看全部");
  });

  it.each([{ q: ["one", "two"] }, { q: "x".repeat(101) }])("renders a stable 400 without searching for %o", async (params) => {
    const markup = await render(params);

    expect(mockedSearchCatalog).not.toHaveBeenCalled();
    expect(markup).toContain(">400<");
    expect(markup).toContain("搜索参数无效");
  });

  it("searches exactly once with the normalized query and preserves it in the form", async () => {
    const markup = await render({ q: "  初音 & Miku  " });

    expect(mockedSearchCatalog).toHaveBeenCalledTimes(1);
    expect(mockedSearchCatalog).toHaveBeenCalledWith("初音 & Miku");
    expect(markup).toContain('value="初音 &amp; Miku"');
  });

  it("renders all group totals and cards while keeping a partial empty group visible", async () => {
    mockedSearchCatalog.mockResolvedValue({
      songs: { items: [song], totalItems: 7, hasMore: true },
      artists: { items: [artist], totalItems: 1, hasMore: false },
      tags: { items: [], totalItems: 0, hasMore: false },
    });

    const markup = await render({ q: "catalog" });

    expect(markup).toContain("Reserved Song");
    expect(markup).toContain("Producer");
    expect(markup).toContain("共 7 首");
    expect(markup).toContain("共 1 位");
    expect(markup).toContain("共 0 个");
    expect(markup).toContain("没有匹配的标签");
    expect(markup).toContain('href="/songs?q=catalog"');
    expect(markup).toContain("查看全部歌曲");
    expect(markup).not.toContain("查看全部作者");
    expect(markup).not.toContain("查看全部标签");
  });

  it("shows view-all links only for groups with more results", async () => {
    mockedSearchCatalog.mockResolvedValue({
      songs: { items: [], totalItems: 0, hasMore: false },
      artists: { items: [artist], totalItems: 7, hasMore: true },
      tags: { items: [tag], totalItems: 7, hasMore: true },
    });

    const markup = await render({ q: "a&b=你好/世界" });

    expect(markup).not.toContain("查看全部歌曲");
    expect(markup).toContain('href="/artists?q=a%26b%3D%E4%BD%A0%E5%A5%BD%2F%E4%B8%96%E7%95%8C"');
    expect(markup).toContain('href="/tags?q=a%26b%3D%E4%BD%A0%E5%A5%BD%2F%E4%B8%96%E7%95%8C"');
  });

  it("encodes normalized queries in view-all URLs", () => {
    expect(searchViewAllHref("/songs", "a&b=你好/世界"))
      .toBe("/songs?q=a%26b%3D%E4%BD%A0%E5%A5%BD%2F%E4%B8%96%E7%95%8C");
  });
});
