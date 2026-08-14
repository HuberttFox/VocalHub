import { describe, expect, it } from "vitest";
import { parseDiscoverySnapshotCleanupArguments } from "../../maintenance/cleanup-discovery-snapshots";

describe("discovery snapshot cleanup CLI", () => {
  it("uses 100 when no limit is provided", () => {
    expect(parseDiscoverySnapshotCleanupArguments([])).toBe(100);
  });

  it("accepts a positive safe integer limit", () => {
    expect(parseDiscoverySnapshotCleanupArguments(["--limit=250"])).toBe(250);
  });

  it("rejects invalid limits", () => {
    for (const args of [
      ["--limit=0"],
      ["--limit=-1"],
      ["--limit=1.5"],
      ["--limit=9007199254740992"],
    ]) {
      expect(() => parseDiscoverySnapshotCleanupArguments(args)).toThrow(
        "Discovery snapshot cleanup limit must be a positive safe integer",
      );
    }
  });

  it("rejects unknown and duplicate arguments", () => {
    expect(() => parseDiscoverySnapshotCleanupArguments(["--dry-run"])).toThrow(
      "Discovery snapshot cleanup accepts only one --limit=<positive safe integer> argument",
    );
    expect(() => parseDiscoverySnapshotCleanupArguments(["--limit=1", "--limit=2"])).toThrow(
      "Discovery snapshot cleanup accepts only one --limit=<positive safe integer> argument",
    );
  });
});
