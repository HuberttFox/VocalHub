import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TagCard } from "@/components/tag-card";

describe("TagCard", () => {
  it("links to the tag and limits alias display to three values", () => {
    const markup = renderToStaticMarkup(createElement(TagCard, {
      tag: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Synthpop",
        additionalNames: ["Alias one", "Alias two", "Alias three", "Alias four"],
        publicSongCount: 3,
      },
    }));

    expect(markup).toContain('href="/tags/00000000-0000-4000-8000-000000000001"');
    expect(markup).toContain("Alias one · Alias two · Alias three");
    expect(markup).not.toContain("Alias four");
    expect(markup).toContain("3 首公开歌曲");
  });
});
