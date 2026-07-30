import { describe, expect, it } from "vitest";
import { mapArtistAliases } from "@/lib/artists/repository";
import { normalizeTagAliases } from "@/lib/tags/mappers";

describe("catalog display mappers", () => {
  it("maps artist aliases in localized-then-additional order", () => {
    expect(
      mapArtistAliases(
        "Primary",
        [
          { language: "Japanese", value: " 別名 " },
          { language: "English", value: "Primary" },
          { language: "Chinese", value: "別名" },
        ],
        [" Extra ", "", "Extra", "extra"],
      ),
    ).toEqual([
      { language: "Japanese", value: "別名" },
      { language: null, value: "Extra" },
      { language: null, value: "extra" },
    ]);
  });

  it("normalizes tag aliases without reordering or case folding", () => {
    expect(normalizeTagAliases([
      " synth ", "", "Synth", "synth", " synth ", "electronic",
    ])).toEqual(["synth", "Synth", "electronic"]);
  });
});
