import { describe, expect, it } from "vitest";
import { SyncRunStatus } from "@/generated/prisma/enums";
import {
  classifyOperationsStatus,
  validateHeartbeatStaleAfterMs,
} from "@/lib/operations/status-policy";

const NOW = new Date("2026-08-10T12:00:00Z");
const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const HEARTBEAT_STALE_AFTER_MS = 5 * 60 * 1_000;

type Evidence = Parameters<typeof classifyOperationsStatus>[0];

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    lastSeedCompletedAt: new Date("2026-08-01T00:00:00Z"),
    activityCheckpoint: new Date("2026-08-10T00:00:00Z"),
    lastReconciledAt: null,
    latestTerminalRunStatuses: [SyncRunStatus.SUCCEEDED, SyncRunStatus.SUCCEEDED],
    hasMultipleRunningManifests: false,
    resumableHeartbeats: [],
    ...overrides,
  };
}

describe("classifyOperationsStatus", () => {
  it("reports UNSEEDED without a completed song seed", () => {
    expect(
      classifyOperationsStatus(evidence({ lastSeedCompletedAt: null }), NOW, STALE_AFTER_MS),
    ).toBe("UNSEEDED");
  });

  it("reports DEGRADED when multiple manifests run for one entity", () => {
    expect(
      classifyOperationsStatus(evidence({ hasMultipleRunningManifests: true }), NOW, STALE_AFTER_MS),
    ).toBe("DEGRADED");
  });

  it("reports DEGRADED when the latest terminal run failed or was partial", () => {
    expect(
      classifyOperationsStatus(
        evidence({ latestTerminalRunStatuses: [SyncRunStatus.FAILED, SyncRunStatus.SUCCEEDED] }),
        NOW,
        STALE_AFTER_MS,
      ),
    ).toBe("DEGRADED");
  });

  it("reports READY when the activity checkpoint is fresh", () => {
    expect(
      classifyOperationsStatus(evidence(), NOW, STALE_AFTER_MS),
    ).toBe("READY");
  });

  it("reports STALE when the activity checkpoint expired", () => {
    expect(
      classifyOperationsStatus(
        evidence({ activityCheckpoint: new Date("2026-08-08T12:00:00Z") }),
        NOW,
        STALE_AFTER_MS,
      ),
    ).toBe("STALE");
  });

  it("treats a fresh reconcile as recent activity while incremental is paused", () => {
    expect(
      classifyOperationsStatus(
        evidence({
          activityCheckpoint: new Date("2026-08-08T12:00:00Z"),
          lastReconciledAt: new Date("2026-08-10T00:00:00Z"),
        }),
        NOW,
        STALE_AFTER_MS,
      ),
    ).toBe("READY");
  });

  it("reports STALE when both checkpoint and reconcile expired", () => {
    expect(
      classifyOperationsStatus(
        evidence({
          activityCheckpoint: new Date("2026-08-08T12:00:00Z"),
          lastReconciledAt: new Date("2026-08-08T13:00:00Z"),
        }),
        NOW,
        STALE_AFTER_MS,
      ),
    ).toBe("STALE");
  });

  it("reports STALE when a seeded catalog has no checkpoint or reconcile activity", () => {
    expect(
      classifyOperationsStatus(
        evidence({ activityCheckpoint: null, lastReconciledAt: null }),
        NOW,
        STALE_AFTER_MS,
      ),
    ).toBe("STALE");
  });

  it("reports READY when a single RUNNING manifest has a fresh heartbeat", () => {
    expect(
      classifyOperationsStatus(
        evidence({ resumableHeartbeats: [new Date("2026-08-10T11:59:00Z")] }),
        NOW,
        STALE_AFTER_MS,
        HEARTBEAT_STALE_AFTER_MS,
      ),
    ).toBe("READY");
  });

  it("reports DEGRADED when a RUNNING manifest heartbeat is stale", () => {
    expect(
      classifyOperationsStatus(
        evidence({ resumableHeartbeats: [new Date("2026-08-10T11:50:00Z")] }),
        NOW,
        STALE_AFTER_MS,
        HEARTBEAT_STALE_AFTER_MS,
      ),
    ).toBe("DEGRADED");
  });

  it("reports DEGRADED when a RUNNING manifest has no heartbeat evidence", () => {
    expect(
      classifyOperationsStatus(
        evidence({ resumableHeartbeats: [null] }),
        NOW,
        STALE_AFTER_MS,
        HEARTBEAT_STALE_AFTER_MS,
      ),
    ).toBe("DEGRADED");
  });

  it("rejects a non-positive heartbeat staleness window", () => {
    expect(() => validateHeartbeatStaleAfterMs(0)).toThrow(RangeError);
    expect(() => validateHeartbeatStaleAfterMs(-1)).toThrow(RangeError);
    expect(() => validateHeartbeatStaleAfterMs(1.5)).toThrow(RangeError);
    expect(validateHeartbeatStaleAfterMs(300_000)).toBe(300_000);
  });
});
