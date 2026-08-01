import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_PREVIEW_LIMIT,
  parseSearchQuery,
} from "@/lib/search/query";

describe("parseSearchQuery", () => {
  it("exports the fixed preview limit", () => {
    expect(SEARCH_PREVIEW_LIMIT).toBe(6);
  });

  it.each([
    [new URLSearchParams(), {}],
    [new URLSearchParams("q="), {}],
    [new URLSearchParams("q=%20%20"), {}],
    [{}, {}],
    [{ q: undefined }, {}],
    [{ q: "  " }, {}],
  ])("accepts missing and blank queries", (input, expected) => {
    expect(parseSearchQuery(input)).toEqual({ success: true, data: expected });
  });

  it("trims a valid query and ignores unknown parameters", () => {
    expect(parseSearchQuery(new URLSearchParams("q=%20miku%20&page=2"))).toEqual({
      success: true,
      data: { q: "miku" },
    });
    expect(parseSearchQuery({ q: "  rin  ", page: ["unexpected"] })).toEqual({
      success: true,
      data: { q: "rin" },
    });
  });

  it("accepts a query at the maximum length", () => {
    const q = "x".repeat(SEARCH_MAX_QUERY_LENGTH);
    expect(parseSearchQuery({ q })).toEqual({ success: true, data: { q } });
  });

  it("rejects duplicate URL query values and array record values", () => {
    expect(parseSearchQuery(new URLSearchParams("q=miku&q=rin"))).toEqual({
      success: false,
    });
    expect(parseSearchQuery({ q: ["miku"] })).toEqual({ success: false });
  });

  it("rejects a trimmed query longer than 100 characters", () => {
    expect(parseSearchQuery({ q: `  ${"x".repeat(101)}  ` })).toEqual({
      success: false,
    });
  });
});
