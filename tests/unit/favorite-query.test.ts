import { describe, expect, it } from "vitest";
import { favoriteInputSchema, parseFavoriteListQuery } from "@/lib/favorites/query";

const songId = "22222222-2222-4222-8222-222222222222";

describe("favorite validation", () => {
  it("parses bounded pagination", () => {
    expect(parseFavoriteListQuery({ page: "2", pageSize: "10" })).toEqual({
      success: true,
      data: { page: 2, pageSize: 10 },
    });
  });

  it("rejects invalid and repeated pagination", () => {
    expect(parseFavoriteListQuery({ page: "0" })).toEqual({ success: false });
    expect(parseFavoriteListQuery({ page: ["1", "2"] })).toEqual({ success: false });
  });

  it("parses explicit desired state", () => {
    expect(favoriteInputSchema.parse({ songId, desired: "true" })).toEqual({
      songId,
      desired: true,
    });
    expect(favoriteInputSchema.parse({ songId, desired: "false" }).desired).toBe(false);
  });
});
