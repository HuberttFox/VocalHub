import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Prisma } from "@/generated/prisma/client";

export interface CapturedQuery {
  sql: string;
  params: unknown[];
  durationMs: number;
  fingerprint: string;
}

export interface QueryCapture {
  start(): void;
  stop(): CapturedQuery[];
}

export interface ScenarioMeasurement<T = unknown> {
  scenario: string;
  warmups: number;
  repeats: number;
  durationsMs: number[];
  summary: TimingSummary;
  deterministic: boolean;
  resultDigest: string;
  queries: CapturedQuery[];
  result: T;
}

export interface TimingSummary {
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
}

export interface MeasureOptions<T> {
  name: string;
  warmups: number;
  repeats: number;
  run(): Promise<T>;
  capture?: QueryCapture;
  digest?: (value: T) => string;
}

/**
 * Measures the complete repository call, not the sum of individual SQL durations.
 * Query capture is enabled only for measured repetitions so warmups cannot pollute
 * the SQL/EXPLAIN evidence.
 */
export async function measureScenario<T>(
  options: MeasureOptions<T>,
): Promise<ScenarioMeasurement<T>> {
  assertCount("warmups", options.warmups, true);
  assertCount("repeats", options.repeats, false);

  for (let index = 0; index < options.warmups; index += 1) {
    await options.run();
  }

  const durationsMs: number[] = [];
  const digests: string[] = [];
  const queriesByFingerprint = new Map<string, CapturedQuery>();
  let result: T | undefined;

  for (let index = 0; index < options.repeats; index += 1) {
    options.capture?.start();
    const startedAt = performance.now();

    try {
      result = await options.run();
    } finally {
      durationsMs.push(performance.now() - startedAt);
      for (const query of options.capture?.stop() ?? []) {
        queriesByFingerprint.set(query.fingerprint, query);
      }
    }

    digests.push((options.digest ?? digestValue)(result));
  }

  const expectedDigest = digests[0];
  const deterministic = digests.every((digest) => digest === expectedDigest);
  if (!deterministic) {
    throw new Error(
      `Scenario ${options.name} returned non-deterministic results: ${digests.join(", ")}`,
    );
  }

  return {
    scenario: options.name,
    warmups: options.warmups,
    repeats: options.repeats,
    durationsMs,
    summary: summarizeDurations(durationsMs),
    deterministic,
    resultDigest: expectedDigest,
    queries: [...queriesByFingerprint.values()],
    result: result as T,
  };
}

export function createPrismaQueryCapture(
  client: { $on(event: "query", callback: (event: Prisma.QueryEvent) => void): unknown },
): QueryCapture {
  let active = false;
  let captured: CapturedQuery[] = [];

  client.$on("query", (event) => {
    if (!active) return;

    captured.push({
      sql: event.query,
      params: parsePrismaParams(event.params),
      durationMs: event.duration,
      fingerprint: fingerprintSql(event.query),
    });
  });

  return {
    start() {
      if (active) throw new Error("Prisma query capture is already active");
      captured = [];
      active = true;
    },
    stop() {
      active = false;
      return captured.slice();
    },
  };
}

export function fingerprintSql(sql: string): string {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function digestValue(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

export function summarizeDurations(values: number[]): TimingSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty duration set");

  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    minMs: sorted[0],
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) as number,
    meanMs: sum / sorted.length,
  };
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)];
}

function parsePrismaParams(params: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(params);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error("Prisma emitted query parameters that were not valid JSON");
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function assertCount(name: string, value: number, allowZero: boolean): void {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
}
