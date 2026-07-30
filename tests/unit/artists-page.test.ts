import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/artists/list-repository", () => ({
  listArtists: vi.fn().mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
  }),
}));

import ArtistsPage from "@/app/artists/page";

describe("ArtistsPage", () => {
  it("preserves a non-default page size when submitting a search", async () => {
    const markup = renderToStaticMarkup(await ArtistsPage({
      searchParams: Promise.resolve({ pageSize: "50" }),
    }));

    expect(markup).toContain('name="pageSize"');
    expect(markup).toContain('value="50"');
  });
});
