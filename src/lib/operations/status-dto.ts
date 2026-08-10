import type {
  SyncEntity,
  SyncRunMode,
  SyncRunStatus,
  SyncStatus,
} from "@/generated/prisma/enums";

export type OperationsStatusClassification =
  | "UNSEEDED"
  | "DEGRADED"
  | "STALE"
  | "READY";

export type OperationsStatusDto = {
  classification: OperationsStatusClassification;
  observedAt: string;
  staleAfterMs: number;
  songs: OperationsSongStatusDto;
  artists: OperationsEntityStatusDto;
  resumableManifests: OperationsResumableManifestDto[];
};

export type OperationsSongStatusDto = OperationsEntityStatusDto & {
  activityCheckpoint: string | null;
  lastSeedCompletedAt: string | null;
  lastReconciledAt: string | null;
};

export type OperationsEntityStatusDto = {
  latestRun: OperationsSyncRunDto | null;
  runningManifestCount: number;
};

export type OperationsSyncRunDto = {
  mode: SyncRunMode;
  status: SyncRunStatus;
  startedAt: string;
  discoveryCompletedAt: string | null;
  finishedAt: string | null;
  requestedCount: number;
  successCount: number;
  failureCount: number;
  itemCounts: Record<SyncStatus, number>;
};

export type OperationsResumableManifestDto = {
  entity: SyncEntity;
  sequence: string;
  mode: SyncRunMode;
  status: SyncRunStatus;
  startedAt: string;
  discoveryCompletedAt: string | null;
  pendingItemCount: number;
  lastHeartbeatAt: string | null;
  heartbeatStale: boolean;
};
