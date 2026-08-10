import { describe, expect, it } from "vitest";
import { SyncRunStatus } from "@/generated/prisma/enums";
import { classifyOperationsStatus } from "@/lib/operations/status-policy";

const NOW = new Date("2026-08-10T12:00:00Z");
const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

type Evidence = Parameters<typeof classifyOperationsStatus>[0];

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    lastSeedCompletedAt: new Date("2026-08-01T00:00:00Z"),
    activityCheckpoint: new Date("2026-08-10T00:00:00Z"),
    lastReconciledAt: null,
    latestTerminalRunStatuses: [SyncRunStatus.SUCCEEDED, SyncRunStatus.SUCCEEDED],
    hasMultipleRunningManifests: false,
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
});
