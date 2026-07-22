import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExplainPlan } from "./explain";
import type { ScenarioMeasurement, TimingSummary } from "./measure";

export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  dataset: Record<string, unknown>;
  environment: {
    database: string;
    node: string;
    platform: string;
  };
  runs: ReportRun[];
  comparison?: ComparisonReport;
}

export interface ReportRun {
  label: string;
  candidate: string | null;
  scenarios: ReportScenario[];
}

export interface ReportScenario {
  name: string;
  warmups: number;
  repeats: number;
  durationsMs: number[];
  summary: TimingSummary;
  deterministic: boolean;
  resultDigest: string;
  queries: Array<{
    fingerprint: string;
    durationMs: number;
  }>;
  explains: ExplainPlan[];
}

export interface ComparisonReport {
  candidate: string;
  scenarios: Array<{
    name: string;
    baselineMedianMs: number;
    candidateMedianMs: number;
    restoredMedianMs: number;
    candidateChangePercent: number;
    baselineDriftPercent: number;
  }>;
}

export function toReportScenario(
  measurement: ScenarioMeasurement,
  explains: ExplainPlan[],
): ReportScenario {
  return {
    name: measurement.scenario,
    warmups: measurement.warmups,
    repeats: measurement.repeats,
    durationsMs: measurement.durationsMs,
    summary: measurement.summary,
    deterministic: measurement.deterministic,
    resultDigest: measurement.resultDigest,
    queries: measurement.queries.map(({ fingerprint, durationMs }) => ({
      fingerprint,
      durationMs,
    })),
    explains,
  };
}

export function compareRuns(
  candidate: string,
  baseline: ReportRun,
  candidateRun: ReportRun,
  restored: ReportRun,
): ComparisonReport {
  return {
    candidate,
    scenarios: baseline.scenarios.map((scenario) => {
      const changed = requireScenario(candidateRun, scenario.name);
      const after = requireScenario(restored, scenario.name);
      const baselineMedianMs = scenario.summary.medianMs;

      if (changed.resultDigest !== scenario.resultDigest || after.resultDigest !== scenario.resultDigest) {
        throw new Error(`Comparison changed deterministic result for ${scenario.name}`);
      }

      return {
        name: scenario.name,
        baselineMedianMs,
        candidateMedianMs: changed.summary.medianMs,
        restoredMedianMs: after.summary.medianMs,
        candidateChangePercent: percentChange(baselineMedianMs, changed.summary.medianMs),
        baselineDriftPercent: percentChange(baselineMedianMs, after.summary.medianMs),
      };
    }),
  };
}

export async function writeReport(path: string, report: BenchmarkReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(redactReport(report), null, 2)}\n`, "utf8");
}

export function printReport(report: BenchmarkReport): void {
  const safe = redactReport(report);
  console.log(`Catalog benchmark: ${safe.command}`);
  console.log(`Database: ${safe.environment.database}`);

  for (const run of safe.runs) {
    console.log(`\n${run.label}${run.candidate ? ` (${run.candidate})` : ""}`);
    console.table(
      run.scenarios.map((scenario) => ({
        scenario: scenario.name,
        medianMs: round(scenario.summary.medianMs),
        p95Ms: round(scenario.summary.p95Ms),
        queries: scenario.queries.length,
        deterministic: scenario.deterministic,
      })),
    );
  }

  if (safe.comparison) {
    console.log(`\nComparison: ${safe.comparison.candidate}`);
    console.table(
      safe.comparison.scenarios.map((scenario) => ({
        scenario: scenario.name,
        baselineMs: round(scenario.baselineMedianMs),
        candidateMs: round(scenario.candidateMedianMs),
        restoredMs: round(scenario.restoredMedianMs),
        changePercent: round(scenario.candidateChangePercent),
        baselineDriftPercent: round(scenario.baselineDriftPercent),
      })),
    );
  }
}

export function redactReport(report: BenchmarkReport): BenchmarkReport {
  return deepRedact(report) as BenchmarkReport;
}

export function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of [...url.searchParams.keys()]) {
      if (/password|secret|token|key/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return "[redacted-database-url]";
  }
}

function deepRedact(value: unknown, key = ""): unknown {
  if (/password|secret|token|authorization/i.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (/database|connection|url/i.test(key) && /^postgres(?:ql)?:\/\//i.test(value)) {
      return redactDatabaseUrl(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => deepRedact(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, deepRedact(entry, entryKey)]),
    );
  }
  return value;
}

function requireScenario(run: ReportRun, name: string): ReportScenario {
  const scenario = run.scenarios.find((entry) => entry.name === name);
  if (!scenario) throw new Error(`Run ${run.label} is missing scenario ${name}`);
  return scenario;
}

function percentChange(baseline: number, next: number): number {
  return baseline === 0 ? 0 : ((next - baseline) / baseline) * 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
