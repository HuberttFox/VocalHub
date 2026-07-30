import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const tag = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Synthpop",
  additionalNames: ["Synth pop", "Synth-pop"],
  publicSongCount: 2,
};

vi.mock("@/lib/tags/repository", () => ({
  getTagDetailById: vi.fn().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Synthpop",
    additionalNames: ["Synth pop", "Synth-pop"],
    publicSongCount: 2,
  }),
  listTagSongs: vi.fn().mockResolvedValue({
    items: [],
    query: { sort: "popular" },
    pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
  }),
}));

import TagPage, { tagSongsPageHref } from "@/app/tags/[id]/page";
import { TagList } from "@/components/tag-list";

describe("TagPage", () => {
  it("renders public tag metadata, song sorting, and defensive empty state", async () => {
    const markup = renderToStaticMarkup(await TagPage({
      params: Promise.resolve({ id: tag.id }),
      searchParams: Promise.resolve({ sort: "popular", pageSize: "10" }),
    }));

    expect(markup).toContain("Synthpop");
    expect(markup).toContain("Synth pop · Synth-pop");
    expect(markup).toContain("2 首公开歌曲");
    expect(markup).toContain("name=\"sort\"");
    expect(markup).toContain("value=\"popular\"");
    expect(markup).toContain('name="pageSize"');
    expect(markup).toContain('value="10"');
    expect(markup).toContain("暂无公开歌曲");
  });

  it("preserves non-default sort and page size in page links", () => {
    expect(tagSongsPageHref(tag.id, { page: 1, pageSize: 10, sort: "popular" }, 2))
      .toBe(`/tags/${tag.id}?sort=popular&pageSize=10&page=2`);
  });
});

describe("TagList", () => {
  it("links each chip by local tag UUID above a SongCard link overlay", () => {
    const markup = renderToStaticMarkup(createElement(TagList, { tags: [tag] }));

    expect(markup).toContain(`href=\"/tags/${tag.id}\"`);
    expect(markup).toContain("class=\"relative z-10 tag-chip\"");
  });
});
