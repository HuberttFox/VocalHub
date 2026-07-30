import { describe, expect, it } from "vitest";
import {
  ENTITY_LIST_DEFAULT_PAGE_SIZE,
  ENTITY_LIST_MAX_PAGE,
  parseEntityListQuery,
} from "@/lib/catalog/entity-list-query";
import { escapeLikePattern } from "@/lib/catalog/literal-search";

describe("parseEntityListQuery", () => {
  it("uses browsable-index defaults", () => {
    expect(parseEntityListQuery(new URLSearchParams())).toEqual({
      success: true,
      data: { page: 1, pageSize: ENTITY_LIST_DEFAULT_PAGE_SIZE },
    });
  });

  it("trims q and accepts bounded paging", () => {
    expect(parseEntityListQuery(new URLSearchParams("q=%20Miku%20&page=2&pageSize=50"))).toEqual({
      success: true,
      data: { q: "Miku", page: 2, pageSize: 50 },
    });
  });

  it("drops blank q", () => {
    expect(parseEntityListQuery({ q: "   " })).toEqual({
      success: true,
      data: { page: 1, pageSize: 24 },
    });
  });

  it.each([
    "q=a&q=b",
    "page=0",
    "page=-1",
    "page=1.5",
    `page=${ENTITY_LIST_MAX_PAGE + 1}`,
    "pageSize=0",
    "pageSize=51",
    `q=${"x".repeat(101)}`,
  ])("rejects invalid URL input %s", (query) => {
    expect(parseEntityListQuery(new URLSearchParams(query))).toEqual({ success: false });
  });

  it("rejects Next.js array values and ignores unknown keys", () => {
    expect(parseEntityListQuery({ q: ["a", "b"] })).toEqual({ success: false });
    expect(parseEntityListQuery({ unknown: ["ignored"] })).toEqual({
      success: true,
      data: { page: 1, pageSize: 24 },
    });
  });
});

describe("escapeLikePattern", () => {
  it("escapes SQL LIKE wildcard and escape characters", () => {
    expect(escapeLikePattern("100%_\\literal")).toBe("100\\%\\_\\\\literal");
  });
});
