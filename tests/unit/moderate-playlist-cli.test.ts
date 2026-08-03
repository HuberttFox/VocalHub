import { describe, expect, it } from "vitest";
import { parseModerationArguments } from "../../maintenance/moderate-playlist";

const playlistId = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";

describe("playlist moderation CLI", () => {
  it("parses bounded report queue and disposition actions", () => {
    expect(parseModerationArguments(["list-reports"])).toEqual({ action: "list-reports", limit: 20 });
    expect(parseModerationArguments(["list-reports", "--limit=100"])).toEqual({ action: "list-reports", limit: 100 });
    expect(parseModerationArguments(["resolve-report", reportId, "illegal-content"])).toEqual({ action: "resolve-report", reportId, resolutionCode: "illegal-content" });
    expect(parseModerationArguments(["dismiss-report", reportId, "duplicate"])).toEqual({ action: "dismiss-report", reportId, resolutionCode: "duplicate" });
  });

  it("preserves existing playlist moderation parsing and rejects unsafe arguments", () => {
    expect(parseModerationArguments(["hide", playlistId])).toEqual({ action: "hide", playlistId });
    expect(() => parseModerationArguments(["list-reports", "--limit=0"])).toThrow();
    expect(() => parseModerationArguments(["list-reports", "--limit=101"])).toThrow();
    expect(() => parseModerationArguments(["resolve-report", reportId, "bad code"])).toThrow();
    expect(() => parseModerationArguments(["resolve-report", "bad", "duplicate"])).toThrow();
  });
});
