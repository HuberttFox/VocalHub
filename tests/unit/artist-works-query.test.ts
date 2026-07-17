import { describe, expect, it } from "vitest";
import { parseArtistWorksQuery } from "@/lib/artists/works-query";

function parse(query = "") { return parseArtistWorksQuery(new URLSearchParams(query)); }

describe("parseArtistWorksQuery", () => {
  it("applies defaults", () => { expect(parse()).toEqual({ success: true, data: { page: 1, pageSize: 24, sort: "latest" } }); });
  it("parses supported values", () => { expect(parse("page=2&pageSize=10&sort=popular")).toEqual({ success: true, data: { page: 2, pageSize: 10, sort: "popular" } }); });
  it.each(["page=0", "page=-1", "page=1.5", "page=no", "page=10001", "pageSize=0", "pageSize=51", "sort=relevance", "page=1&page=2"])("rejects %s", (query) => { expect(parse(query)).toEqual({ success: false }); });
  it("rejects array search params", () => { expect(parseArtistWorksQuery({ page: ["1", "2"] })).toEqual({ success: false }); });
});
