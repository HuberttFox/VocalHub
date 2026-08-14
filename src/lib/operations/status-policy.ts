import { SyncRunStatus } from "@/generated/prisma/enums";
import type { OperationsStatusClassification } from "@/lib/operations/status-dto";

export const DEFAULT_OPERATIONS_STATUS_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 5 * 60 * 1_000;

type StatusEvidence = {
  lastSeedCompletedAt: Date | null;
  activityCheckpoint: Date | null;
  lastReconciledAt: Date | null;
  latestTerminalRunStatuses: Array<
    (typeof SyncRunStatus)[keyof typeof SyncRunStatus] | null
  >;
  hasMultipleRunningManifests: boolean;
  resumableHeartbeats: Array<Date | null>;
  hasDiscoveryRefreshFailure?: boolean;
};

export function validateOperationsStatusStaleAfterMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "Operations status staleAfterMs must be a positive safe integer",
    );
  }
  return value;
}

export function validateHeartbeatStaleAfterMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "Operations status heartbeatStaleAfterMs must be a positive safe integer",
    );
  }
  return value;
}

export function isHeartbeatStale(
  now: Date,
  lastHeartbeatAt: Date | null,
  heartbeatStaleAfterMs: number,
): boolean {
  validateHeartbeatStaleAfterMs(heartbeatStaleAfterMs);
  if (!lastHeartbeatAt) return true;
  return now.getTime() - lastHeartbeatAt.getTime() >= heartbeatStaleAfterMs;
}

export function classifyOperationsStatus(
  evidence: StatusEvidence,
  now: Date,
  staleAfterMs: number,
  heartbeatStaleAfterMs: number = DEFAULT_HEARTBEAT_STALE_AFTER_MS,
): OperationsStatusClassification {
  validateOperationsStatusStaleAfterMs(staleAfterMs);
  validateHeartbeatStaleAfterMs(heartbeatStaleAfterMs);

  if (!evidence.lastSeedCompletedAt) return "UNSEEDED";

  if (
    evidence.hasMultipleRunningManifests ||
    evidence.hasDiscoveryRefreshFailure ||
    evidence.latestTerminalRunStatuses.some(
      (status) =>
        status === SyncRunStatus.FAILED || status === SyncRunStatus.PARTIAL,
    ) ||
    evidence.resumableHeartbeats.some((heartbeat) =>
      isHeartbeatStale(now, heartbeat, heartbeatStaleAfterMs),
    )
  ) {
    return "DEGRADED";
  }

  const lastActivityAt = mostRecent(
    evidence.activityCheckpoint,
    evidence.lastReconciledAt,
  );

  if (
    !lastActivityAt ||
    now.getTime() - lastActivityAt.getTime() >= staleAfterMs
  ) {
    return "STALE";
  }

  return "READY";
}

function mostRecent(...dates: Array<Date | null>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }
  return latest;
}
