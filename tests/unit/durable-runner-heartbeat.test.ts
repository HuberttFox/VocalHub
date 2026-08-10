import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startRunHeartbeat,
  validateHeartbeatIntervalMs,
} from "@/lib/vocadb/durable-sync-runner";

function fakeDb(update: ReturnType<typeof vi.fn>) {
  return {
    syncRun: { update },
  } as unknown as Parameters<typeof startRunHeartbeat>[0]["db"];
}

describe("validateHeartbeatIntervalMs", () => {
  it("rejects non-positive or non-integer intervals", () => {
    expect(() => validateHeartbeatIntervalMs(0)).toThrow(RangeError);
    expect(() => validateHeartbeatIntervalMs(-1)).toThrow(RangeError);
    expect(() => validateHeartbeatIntervalMs(1.5)).toThrow(RangeError);
    expect(validateHeartbeatIntervalMs(30_000)).toBe(30_000);
  });
});

describe("startRunHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes lastHeartbeatAt on every interval and stops when stopped", () => {
    const update = vi.fn().mockResolvedValue({});
    const db = fakeDb(update);
    const now = () => new Date("2026-08-10T12:00:00Z");
    const logger = { log: vi.fn(), error: vi.fn() };

    const heartbeat = startRunHeartbeat(
      { db, now, logger },
      "run-1",
      1_000,
    );
    vi.advanceTimersByTime(2_500);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "run-1" },
      data: { lastHeartbeatAt: now() },
    });

    heartbeat.stop();
    vi.advanceTimersByTime(3_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("logs a failed heartbeat write and keeps beating", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({});
    const db = fakeDb(update);
    const error = vi.fn();
    const logger = { log: vi.fn(), error };

    const heartbeat = startRunHeartbeat(
      { db, now: () => new Date(), logger },
      "run-1",
      1_000,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Heartbeat update failed for sync run run-1"),
    );
    expect(update).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });
});
