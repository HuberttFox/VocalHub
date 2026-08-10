import { SyncRunStatus } from "@/generated/prisma/enums";
import type { OperationsStatusClassification } from "@/lib/operations/status-dto";

export const DEFAULT_OPERATIONS_STATUS_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

type StatusEvidence = {
  lastSeedCompletedAt: Date | null;
  activityCheckpoint: Date | null;
  lastReconciledAt: Date | null;
  latestTerminalRunStatuses: Array<
    (typeof SyncRunStatus)[keyof typeof SyncRunStatus] | null
  >;
  hasMultipleRunningManifests: boolean;
};

export function validateOperationsStatusStaleAfterMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "Operations status staleAfterMs must be a positive safe integer",
    );
  }
  return value;
}

export function classifyOperationsStatus(
  evidence: StatusEvidence,
  now: Date,
  staleAfterMs: number,
): OperationsStatusClassification {
  validateOperationsStatusStaleAfterMs(staleAfterMs);

  if (!evidence.lastSeedCompletedAt) return "UNSEEDED";

  if (
    evidence.hasMultipleRunningManifests ||
    evidence.latestTerminalRunStatuses.some(
      (status) =>
        status === SyncRunStatus.FAILED || status === SyncRunStatus.PARTIAL,
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
