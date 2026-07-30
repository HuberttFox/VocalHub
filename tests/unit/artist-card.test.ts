import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtistCard } from "@/components/artist-card";

describe("ArtistCard", () => {
  it("links to the artist and limits alias display to three values", () => {
    const markup = renderToStaticMarkup(createElement(ArtistCard, {
      artist: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Producer",
        aliases: [
          { language: null, value: "Alias one" },
          { language: "Japanese", value: "Alias two" },
          { language: null, value: "Alias three" },
          { language: null, value: "Alias four" },
        ],
        avatarUrl: null,
        publicSongCount: 3,
      },
    }));

    expect(markup).toContain('href="/artists/00000000-0000-4000-8000-000000000001"');
    expect(markup).toContain("Alias one · Alias two · Alias three");
    expect(markup).not.toContain("Alias four");
    expect(markup).toContain("3 首公开作品");
    expect(markup).toContain("作者头像不可用");
  });
});
