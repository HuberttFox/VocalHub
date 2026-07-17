import { describe, expect, it } from "vitest";
import {
  SONG_LIST_DEFAULT_PAGE_SIZE,
  parseSongListQuery,
} from "@/lib/songs/list-query";

function parse(value = "") {
  return parseSongListQuery(new URLSearchParams(value));
}

describe("parseSongListQuery", () => {
  it("applies defaults and treats blank search as absent", () => {
    expect(parse()).toEqual({
      success: true,
      data: { page: 1, pageSize: SONG_LIST_DEFAULT_PAGE_SIZE, sort: "latest" },
    });
    expect(parse("q=%20%20")).toEqual({
      success: true,
      data: { page: 1, pageSize: SONG_LIST_DEFAULT_PAGE_SIZE, sort: "latest" },
    });
  });

  it("parses supported values", () => {
    expect(parse("q=Miku&page=2&pageSize=10&sort=popular")).toEqual({
      success: true,
      data: { q: "Miku", page: 2, pageSize: 10, sort: "popular" },
    });
  });

  it.each([
    "page=0",
    "page=-1",
    "page=1.5",
    "page=nope",
    "page=10001",
    "pageSize=0",
    "pageSize=51",
    "sort=relevance",
    `q=${"x".repeat(101)}`,
    "q=one&q=two",
    "page=1&page=2",
  ])("rejects invalid query %s", (query) => {
    expect(parse(query)).toEqual({ success: false });
  });

  it("accepts Next.js search param records", () => {
    expect(
      parseSongListQuery({ q: "tag", page: "3", sort: "popular" }),
    ).toEqual({
      success: true,
      data: {
        q: "tag",
        page: 3,
        pageSize: SONG_LIST_DEFAULT_PAGE_SIZE,
        sort: "popular",
      },
    });
    expect(parseSongListQuery({ q: ["one", "two"] })).toEqual({
      success: false,
    });
  });
});
