import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getViewer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/auth", () => ({
  signOut: vi.fn(),
}));

import { SiteHeader } from "@/components/site-header";

describe("SiteHeader", () => {
  it("keeps the song catalog and exposes full-site search in primary navigation", () => {
    const markup = renderToStaticMarkup(createElement(SiteHeader));

    expect(markup).toContain('href="/songs"');
    expect(markup).toContain("歌曲目录");
    expect(markup).toContain('href="/search"');
    expect(markup).toContain("全站搜索");
  });
});
