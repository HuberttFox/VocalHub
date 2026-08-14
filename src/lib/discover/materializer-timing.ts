const DEFAULT_BUILD_TIMEOUT_MS = 5 * 60_000;
const MIN_BUILD_TIMEOUT_MS = 30_000;
const MAX_BUILD_TIMEOUT_MS = 20 * 60_000;
const STATEMENT_TIMEOUT_MARGIN_MS = 10_000;
export const SHORT_TRANSACTION_TIMEOUT_MS = 60_000;
const LEASE_FINALIZATION_MARGIN_MS = 2 * SHORT_TRANSACTION_TIMEOUT_MS;
export const DEFAULT_BATCH_BUDGET_MS = 24 * 60_000;
export const MAX_BATCH_BUDGET_MS = DEFAULT_BATCH_BUDGET_MS;

export type DiscoveryMaterializerTiming = {
  buildTimeoutMs: number;
  statementTimeoutMs: number;
  buildLeaseMs: number;
};

export type DiscoveryMaterializerBatchTiming = DiscoveryMaterializerTiming & {
  batchBudgetMs: number;
  attemptReservationMs: number;
};

export function getDiscoveryMaterializerTiming(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DiscoveryMaterializerTiming {
  const buildTimeoutMs = parseBuildTimeout(environment.DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS);
  return {
    buildTimeoutMs,
    statementTimeoutMs: buildTimeoutMs - STATEMENT_TIMEOUT_MARGIN_MS,
    buildLeaseMs: buildTimeoutMs + LEASE_FINALIZATION_MARGIN_MS,
  };
}

export function getDiscoveryMaterializerBatchTiming(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DiscoveryMaterializerBatchTiming {
  const timing = getDiscoveryMaterializerTiming(environment);
  const batchBudgetMs = parseBatchBudget(environment.DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS);
  const attemptReservationMs = timing.buildTimeoutMs + (2 * SHORT_TRANSACTION_TIMEOUT_MS);
  if (batchBudgetMs < attemptReservationMs) {
    throw new RangeError(
      `DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS must be at least ${attemptReservationMs} milliseconds for the configured build timeout`,
    );
  }
  return { ...timing, batchBudgetMs, attemptReservationMs };
}

function parseBuildTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BUILD_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) {
    throw new RangeError("DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS must be a whole number of milliseconds");
  }

  const buildTimeoutMs = Number(value);
  if (!Number.isSafeInteger(buildTimeoutMs)
    || buildTimeoutMs < MIN_BUILD_TIMEOUT_MS
    || buildTimeoutMs > MAX_BUILD_TIMEOUT_MS) {
    throw new RangeError(
      "DISCOVERY_MATERIALIZER_BUILD_TIMEOUT_MS must be between 30000 and 1200000 milliseconds",
    );
  }
  return buildTimeoutMs;
}

function parseBatchBudget(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_BUDGET_MS;
  if (!/^\d+$/.test(value)) {
    throw new RangeError("DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS must be a whole number of milliseconds");
  }

  const batchBudgetMs = Number(value);
  if (!Number.isSafeInteger(batchBudgetMs)
    || batchBudgetMs <= 0
    || batchBudgetMs > MAX_BATCH_BUDGET_MS) {
    throw new RangeError(
      "DISCOVERY_MATERIALIZER_BATCH_BUDGET_MS must be between 1 and 1440000 milliseconds",
    );
  }
  return batchBudgetMs;
}