import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/auth/return-path";

describe("safeReturnPath", () => {
  it("keeps local paths", () => {
    expect(safeReturnPath("/songs/123?from=login#details")).toBe(
      "/songs/123?from=login#details",
    );
  });

  it.each([
    undefined,
    "",
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "/safe\nLocation: https://evil.example",
  ])("rejects unsafe return path %s", (value) => {
    expect(safeReturnPath(value)).toBe("/favorites");
  });
});
