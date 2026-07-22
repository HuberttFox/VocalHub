import { describe, expect, it, vi } from "vitest";
import { parseSyncArgs } from "@/lib/vocadb/sync-cli";
import {
  ActivityIntervalSaturatedError,
  digestIds,
  discoverActivityIds,
  normalizeIds,
} from "@/lib/vocadb/sync-runner";

function entries(count: number, idOffset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    createDate: "2026-07-18T00:00:00Z",
    editEvent: "Updated",
    entry: { id: idOffset + index + 1, entryType: "Song" as const },
  }));
}

describe("sync CLI", () => {
  it("parses explicit modes and normalized IDs", () => {
    expect(parseSyncArgs(["ids", "--ids=3,1,3"])).toEqual({
      mode: "IDS",
      ids: [1, 3],
    });
    expect(parseSyncArgs(["seed"])).toEqual({ mode: "SEED" });
    expect(parseSyncArgs(["incremental"])).toEqual({ mode: "INCREMENTAL" });
    expect(parseSyncArgs(["reconcile"])).toEqual({ mode: "RECONCILE" });
    expect(parseSyncArgs(["resume"])).toEqual({ mode: "RESUME" });
    expect(parseSyncArgs(["auto", "incremental"])).toEqual({
      mode: "AUTO",
      target: "INCREMENTAL",
    });
  });

  it("rejects invalid arguments", () => {
    for (const args of [
      [],
      ["ids"],
      ["seed", "--ids=1"],
      ["ids", "--ids=0"],
      ["auto"],
      ["auto", "ids"],
      ["auto", "incremental", "extra"],
      ["unknown"],
    ]) {
      expect(() => parseSyncArgs(args)).toThrow();
    }
  });
});

describe("sync discovery helpers", () => {
  it("normalizes and hashes IDs deterministically", () => {
    expect(normalizeIds([3, 1, 3])).toEqual([1, 3]);
    expect(digestIds([3, 1, 3])).toBe(digestIds([1, 3]));
    expect(digestIds([])).toHaveLength(64);
  });

  it("stops activity discovery before an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = { getSongActivityEntries: vi.fn() };

    await expect(
      discoverActivityIds(
        client,
        new Date("2026-07-18T00:00:00Z"),
        new Date("2026-07-18T01:00:00Z"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(client.getSongActivityEntries).not.toHaveBeenCalled();
  });

  it("returns deduplicated IDs from an unsaturated interval", async () => {
    const client = {
      getSongActivityEntries: vi.fn().mockResolvedValue([
        ...entries(2),
        { ...entries(1)[0], entry: { id: 2, entryType: "Song" as const } },
      ]),
    };

    await expect(
      discoverActivityIds(
        client,
        new Date("2026-07-18T00:00:00Z"),
        new Date("2026-07-18T01:00:00Z"),
      ),
    ).resolves.toEqual([1, 2]);
  });

  it("subdivides saturated intervals and deduplicates boundaries", async () => {
    const client = {
      getSongActivityEntries: vi
        .fn()
        .mockResolvedValueOnce(entries(500))
        .mockResolvedValueOnce(entries(2))
        .mockResolvedValueOnce(entries(2, 1)),
    };

    await expect(
      discoverActivityIds(
        client,
        new Date("2026-07-18T00:00:00.000Z"),
        new Date("2026-07-18T00:00:00.010Z"),
      ),
    ).resolves.toEqual([1, 2, 3]);
    expect(client.getSongActivityEntries).toHaveBeenCalledTimes(3);
  });

  it("fails a saturated interval whose overlap cannot make progress", async () => {
    const client = {
      getSongActivityEntries: vi.fn().mockResolvedValue(entries(500)),
    };

    await expect(
      discoverActivityIds(
        client,
        new Date("2026-07-18T00:00:00.000Z"),
        new Date("2026-07-18T00:00:00.003Z"),
      ),
    ).rejects.toBeInstanceOf(ActivityIntervalSaturatedError);
    expect(client.getSongActivityEntries).toHaveBeenCalledTimes(1);
  });

  it("fails an indivisible saturated interval", async () => {
    const client = {
      getSongActivityEntries: vi.fn().mockResolvedValue(entries(500)),
    };

    await expect(
      discoverActivityIds(
        client,
        new Date("2026-07-18T00:00:00.000Z"),
        new Date("2026-07-18T00:00:00.001Z"),
      ),
    ).rejects.toBeInstanceOf(ActivityIntervalSaturatedError);
  });
});
