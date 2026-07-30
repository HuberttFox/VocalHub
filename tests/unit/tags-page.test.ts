import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tags/repository", () => ({
  listTags: vi.fn().mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
  }),
}));

import TagsPage, { tagPageHref } from "@/app/tags/page";

describe("TagsPage", () => {
  it("preserves a non-default page size when submitting a search", async () => {
    const markup = renderToStaticMarkup(await TagsPage({
      searchParams: Promise.resolve({ pageSize: "50" }),
    }));

    expect(markup).toContain('name="pageSize"');
    expect(markup).toContain('value="50"');
    expect(markup).toContain("标签目录");
    expect(markup).toContain("标签名或精确别名");
    expect(markup).toContain("surface mt-10 flex flex-wrap items-end gap-4 p-5");
  });

  it("omits default query parameters from tag page links", () => {
    expect(tagPageHref({ page: 1, pageSize: 24 }, 1)).toBe("/tags");
    expect(tagPageHref({ q: "Synth", page: 1, pageSize: 50 }, 2))
      .toBe("/tags?q=Synth&pageSize=50&page=2");
  });
});
