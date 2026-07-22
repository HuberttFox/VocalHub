import {
  VOCADB_BASE_URL,
  VOCADB_TIMEOUT_MS,
  VOCADB_USER_AGENT,
} from "@/lib/vocadb/client";
import {
  DEFAULT_ACTIVITY_OVERLAP_MS,
  DEFAULT_SETTLEMENT_LAG_MS,
  DEFAULT_SYNC_CONCURRENCY,
} from "@/lib/vocadb/sync-runner";

const DATABASE_PROTOCOLS = ["postgres:", "postgresql:"];
const HTTP_PROTOCOLS = ["http:", "https:"];
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_SYNC_CONCURRENCY = 32;
const MAX_USER_AGENT_LENGTH = 500;

type Environment = Record<string, string | undefined>;

export type VocaDbWorkerConfig = {
  connectionString: string;
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  activityOverlapMs: number;
  settlementLagMs: number;
  concurrency: number;
};

export function parseVocaDbWorkerConfig(
  environment: Environment,
): VocaDbWorkerConfig {
  const connectionString = requiredValue(environment.DATABASE_URL, "DATABASE_URL");
  assertUrlProtocol(connectionString, "DATABASE_URL", DATABASE_PROTOCOLS);

  const baseUrl = environment.VOCADB_BASE_URL?.trim() || VOCADB_BASE_URL;
  const baseUrlProtocol = assertUrlProtocol(
    baseUrl,
    "VOCADB_BASE_URL",
    HTTP_PROTOCOLS,
  );
  if (environment.NODE_ENV === "production" && baseUrlProtocol !== "https:") {
    throw new Error("VOCADB_BASE_URL must use HTTPS in production");
  }

  const userAgent = environment.VOCADB_USER_AGENT?.trim() || VOCADB_USER_AGENT;
  if (environment.NODE_ENV === "production" && !environment.VOCADB_USER_AGENT?.trim()) {
    throw new Error("VOCADB_USER_AGENT is required in production");
  }
  if (userAgent.length > MAX_USER_AGENT_LENGTH) {
    throw new Error(
      `VOCADB_USER_AGENT must be at most ${MAX_USER_AGENT_LENGTH} characters`,
    );
  }

  return {
    connectionString,
    baseUrl,
    userAgent,
    timeoutMs: parseInteger(
      environment.VOCADB_TIMEOUT_MS,
      "VOCADB_TIMEOUT_MS",
      VOCADB_TIMEOUT_MS,
      1,
      MAX_TIMER_DELAY_MS,
    ),
    activityOverlapMs: parseInteger(
      environment.VOCADB_ACTIVITY_OVERLAP_MS,
      "VOCADB_ACTIVITY_OVERLAP_MS",
      DEFAULT_ACTIVITY_OVERLAP_MS,
      0,
    ),
    settlementLagMs: parseInteger(
      environment.VOCADB_SETTLEMENT_LAG_MS,
      "VOCADB_SETTLEMENT_LAG_MS",
      DEFAULT_SETTLEMENT_LAG_MS,
      0,
    ),
    concurrency: parseInteger(
      environment.VOCADB_SYNC_CONCURRENCY,
      "VOCADB_SYNC_CONCURRENCY",
      DEFAULT_SYNC_CONCURRENCY,
      1,
      MAX_SYNC_CONCURRENCY,
    ),
  };
}

function requiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function assertUrlProtocol(
  value: string,
  name: string,
  protocols: readonly string[],
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} uses an unsupported protocol`);
  }
  return url.protocol;
}

function parseInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}
