import { describe, expect, it, vi } from "vitest";
import { withCatalogBenchmarkLock } from "../../benchmarks/catalog/load";

describe("catalog benchmark load lock", () => {
  it("holds and releases the same PostgreSQL session around the operation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const lockClient = { query } as unknown as Parameters<
      typeof withCatalogBenchmarkLock
    >[0];
    const operation = vi.fn().mockResolvedValue("loaded");

    await expect(
      withCatalogBenchmarkLock(lockClient, operation),
    ).resolves.toBe("loaded");
    expect(operation).toHaveBeenCalledOnce();
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_try_advisory_lock"),
      [0x564f4341, 0x54434c49],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("pg_advisory_unlock"),
      [0x564f4341, 0x54434c49],
    );
  });
});
