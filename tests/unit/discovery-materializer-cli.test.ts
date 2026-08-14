import { describe, expect, it } from "vitest";
import { parseDiscoveryMaterializerArguments } from "../../maintenance/materialize-discovery";

describe("discovery materializer CLI", () => {
  it("uses 100 when no limit is provided", () => {
    expect(parseDiscoveryMaterializerArguments([])).toBe(100);
  });

  it("accepts a positive safe integer limit", () => {
    expect(parseDiscoveryMaterializerArguments(["--limit=250"])).toBe(250);
  });

  it("rejects invalid limits", () => {
    for (const args of [
      ["--limit=0"],
      ["--limit=-1"],
      ["--limit=1.5"],
      ["--limit=9007199254740992"],
    ]) {
      expect(() => parseDiscoveryMaterializerArguments(args)).toThrow(
        "Discovery materializer limit must be a positive safe integer",
      );
    }
  });

  it("rejects unknown and duplicate arguments", () => {
    expect(() => parseDiscoveryMaterializerArguments(["--dry-run"])).toThrow(
      "Discovery materializer accepts only one --limit=<positive safe integer> argument",
    );
    expect(() => parseDiscoveryMaterializerArguments(["--limit=1", "--limit=2"])).toThrow(
      "Discovery materializer accepts only one --limit=<positive safe integer> argument",
    );
  });
});
