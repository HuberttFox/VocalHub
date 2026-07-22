#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { listArtistWorks } from "@/lib/artists/repository";
import { listSongs } from "@/lib/songs/repository";
import { parseCatalogBenchmarkConfig } from "./config";
import {
  createCatalogBenchmarkClient,
  createCatalogQueryEventCollector,
  type CatalogBenchmarkClient,
} from "./db";
import { explainCapturedQueries } from "./explain";
import {
  assertNoBenchmarkIndexes,
  cleanupBenchmarkIndexes,
  getIndexCandidate,
  installCandidate,
  removeCandidate,
  type IndexCandidate,
} from "./index-candidates";
import { loadCatalogBenchmark, readCatalogBenchmarkMarker } from "./load";
import {
  fingerprintSql,
  measureScenario,
  type CapturedQuery,
  type QueryCapture,
} from "./measure";
import {
  compareRuns,
  printReport,
  toReportScenario,
  writeReport,
  type BenchmarkReport,
  type ReportRun,
} from "./report";
import {
  checkCatalogBenchmarkResult,
  defineCatalogBenchmarkScenarios,
  type CatalogBenchmarkScenario,
  type CatalogBenchmarkScenarioResult,
} from "./scenarios";
import type { CatalogBenchmarkMarker } from "./types";

const DEFAULT_SEED = 20_260_720;
const DEFAULT_WARMUPS = 3;
const DEFAULT_REPEATS = 15;
const DEFAULT_SIZES = [5_000, 10_000, 20_000] as const;
const CLI_LOCK_KEYS = [0x564f4341, 0x54434c49];

interface Arguments {
  _: string[];
  [key: string]: string | boolean | string[];
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help === true) return printUsage();

  const config = parseCatalogBenchmarkConfig(process.env);

  switch (command) {
    case "setup":
      await withPgClient(config.connectionString, (pg) =>
        withAdvisoryLock(pg, async () => {
          await assertConnectedDatabase(pg, config.databaseName);
          await deployBenchmarkSchema(config.connectionString);
          if (args["install-pg-trgm"] === true) {
            await pg.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
          }
        }),
      );
      console.log(`Benchmark schema deployed to ${config.databaseIdentity}`);
      return;

    case "load": {
      const db = createCatalogBenchmarkClient(config.connectionString);
      try {
        const loaded = await withPgClient(config.connectionString, (lockClient) =>
          loadCatalogBenchmark(db, lockClient, config, {
            songCount: integerOption(args, "songs", undefined),
            seed: integerOption(args, "seed", DEFAULT_SEED),
            chunkSize: optionalIntegerOption(args, "chunk-size"),
            confirmReset: stringOption(args, "confirm-reset"),
          }),
        );
        console.log(JSON.stringify({ database: config.databaseIdentity, loaded }, null, 2));
      } finally {
        await db.$disconnect();
      }
      return;
    }

    case "run": {
      const report = await runLockedBenchmark(config.connectionString, config.databaseName, {
        command,
        databaseIdentity: config.databaseIdentity,
        warmups: integerOption(args, "warmups", DEFAULT_WARMUPS),
        repeats: integerOption(args, "repeats", DEFAULT_REPEATS),
        scenarioIds: scenarioIdsOption(args),
      });
      await emitReport(report, optionalStringOption(args, "output"));
      return;
    }

    case "compare": {
      const candidate = getIndexCandidate(stringOption(args, "candidate"));
      requireConfirmation(args, config.databaseName);
      const report = await compareLockedBenchmark(
        config.connectionString,
        config.databaseName,
        config.databaseIdentity,
        candidate,
        integerOption(args, "warmups", DEFAULT_WARMUPS),
        integerOption(args, "repeats", DEFAULT_REPEATS),
        scenarioIdsOption(args),
      );
      await emitReport(report, optionalStringOption(args, "output"));
      return;
    }

    case "matrix":
      requireConfirmation(args, config.databaseName);
      await runMatrix(args, config);
      return;

    default:
      throw new Error(`Unknown command ${command}`);
  }
}

async function runMatrix(
  args: Arguments,
  config: ReturnType<typeof parseCatalogBenchmarkConfig>,
): Promise<void> {
  const sizes = optionalStringOption(args, "sizes")
    ?.split(",")
    .map((value) => parseInteger(value, "sizes")) ?? [...DEFAULT_SIZES];
  const candidateName = optionalStringOption(args, "candidate");
  const outputDirectory = optionalStringOption(args, "output-dir") ?? ".benchmark-results";
  const seed = integerOption(args, "seed", DEFAULT_SEED);
  const warmups = integerOption(args, "warmups", DEFAULT_WARMUPS);
  const repeats = integerOption(args, "repeats", DEFAULT_REPEATS);
  const scenarioIds = scenarioIdsOption(args);

  for (const songCount of sizes) {
    const loader = createCatalogBenchmarkClient(config.connectionString);
    try {
      await withPgClient(config.connectionString, (lockClient) =>
        loadCatalogBenchmark(loader, lockClient, config, {
          songCount,
          seed,
          chunkSize: optionalIntegerOption(args, "chunk-size"),
          confirmReset: config.databaseName,
        }),
      );
    } finally {
      await loader.$disconnect();
    }

    const report = candidateName
      ? await compareLockedBenchmark(
          config.connectionString,
          config.databaseName,
          config.databaseIdentity,
          getIndexCandidate(candidateName),
          warmups,
          repeats,
          scenarioIds,
        )
      : await runLockedBenchmark(config.connectionString, config.databaseName, {
          command: "matrix",
          databaseIdentity: config.databaseIdentity,
          warmups,
          repeats,
          scenarioIds,
        });
    const suffix = candidateName ? `compare-${candidateName}` : "baseline";
    await emitReport(report, resolve(outputDirectory, `catalog-${songCount}-${suffix}.json`));
  }
}

async function runLockedBenchmark(
  connectionString: string,
  databaseName: string,
  options: {
    command: string;
    databaseIdentity: string;
    warmups: number;
    repeats: number;
    scenarioIds?: ReadonlySet<string>;
  },
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await assertNoBenchmarkIndexes(pg);
      const { marker, run } = await executeRun(
        connectionString,
        pg,
        "baseline-A",
        null,
        options.warmups,
        options.repeats,
        options.scenarioIds,
      );
      return createReport(options.command, options.databaseIdentity, marker, [run]);
    }),
  );
}

async function compareLockedBenchmark(
  connectionString: string,
  databaseName: string,
  databaseIdentity: string,
  candidate: IndexCandidate,
  warmups: number,
  repeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await cleanupBenchmarkIndexes(pg);

      const baseline = await executeRun(connectionString, pg, "baseline-A", null, warmups, repeats, scenarioIds);
      let changed: Awaited<ReturnType<typeof executeRun>>;

      try {
        await installCandidate(pg, candidate);
        changed = await executeRun(connectionString, pg, "candidate-B", candidate.name, warmups, repeats, scenarioIds);
      } finally {
        await removeCandidate(pg, candidate);
      }

      const restored = await executeRun(connectionString, pg, "baseline-A2", null, warmups, repeats, scenarioIds);
      const runs = [baseline.run, changed.run, restored.run];
      return {
        ...createReport("compare", databaseIdentity, baseline.marker, runs),
        comparison: compareRuns(candidate.name, baseline.run, changed.run, restored.run),
      };
    }),
  );
}

async function executeRun(
  connectionString: string,
  pg: PoolClient,
  label: string,
  candidate: string | null,
  warmups: number,
  repeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<{ marker: CatalogBenchmarkMarker; run: ReportRun }> {
  const collector = createCatalogQueryEventCollector();
  const db = createCatalogBenchmarkClient(connectionString, collector.onQuery);

  try {
    const marker = await requireMarker(db);
    const scenarios = defineCatalogBenchmarkScenarios({ marker }, scenarioIds);
    if (scenarios.length === 0) throw new Error("No benchmark scenarios selected");
    const reports = [];

    for (const scenario of scenarios) {
      const capture = collectorCapture(collector);
      const measurement = await measureScenario({
        name: scenario.id,
        warmups,
        repeats,
        capture,
        run: () => runScenario(db, scenario),
        digest: (result) => checkCatalogBenchmarkResult(scenario, result).checksum,
      });
      const explains = await explainCapturedQueries(pg, measurement.queries);
      reports.push(toReportScenario(measurement, explains));
    }

    return { marker, run: { label, candidate, scenarios: reports } };
  } finally {
    await db.$disconnect();
  }
}

async function runScenario(
  db: CatalogBenchmarkClient,
  scenario: CatalogBenchmarkScenario,
): Promise<CatalogBenchmarkScenarioResult> {
  return scenario.kind === "songs"
    ? listSongs(scenario.query, db)
    : listArtistWorks(scenario.artistId, scenario.query, db);
}

function collectorCapture(
  collector: ReturnType<typeof createCatalogQueryEventCollector>,
): QueryCapture {
  return {
    start: () => collector.clear(),
    stop: () =>
      collector.snapshot().map<CapturedQuery>((event) => ({
        sql: event.query,
        params: parseParams(event.params),
        durationMs: event.durationMs,
        fingerprint: fingerprintSql(event.query),
      })),
  };
}

async function requireMarker(db: CatalogBenchmarkClient): Promise<CatalogBenchmarkMarker> {
  const marker = await readCatalogBenchmarkMarker(db);
  if (!marker) throw new Error("No benchmark dataset marker; run load first");
  return marker;
}

function createReport(
  command: string,
  database: string,
  marker: CatalogBenchmarkMarker,
  runs: ReportRun[],
): BenchmarkReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command,
    dataset: marker,
    environment: { database, node: process.version, platform: process.platform },
    runs,
  };
}

async function emitReport(report: BenchmarkReport, output?: string): Promise<void> {
  printReport(report);
  if (output) {
    await writeReport(output, report);
    console.log(`\nJSON report: ${output}`);
  }
}

async function withPgClient<T>(
  connectionString: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function withAdvisoryLock<T>(db: PoolClient, operation: () => Promise<T>): Promise<T> {
  const result = await db.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
    CLI_LOCK_KEYS,
  );
  if (result.rows[0]?.acquired !== true) {
    throw new Error("Another catalog benchmark CLI holds the advisory lock");
  }
  try {
    return await operation();
  } finally {
    await db.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", CLI_LOCK_KEYS);
  }
}

async function assertConnectedDatabase(db: PoolClient, expected: string): Promise<void> {
  const result = await db.query<{ name: string }>("SELECT current_database() AS name");
  if (result.rows[0]?.name !== expected || !expected.endsWith("_benchmark")) {
    throw new Error(`Refusing benchmark command on database ${result.rows[0]?.name ?? "<unknown>"}`);
  }
}

async function deployBenchmarkSchema(connectionString: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: connectionString },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`prisma migrate deploy failed (${signal ?? `exit ${code}`})`));
    });
  });
}

function parseParams(value: string): unknown[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Prisma query params were not an array");
  return parsed;
}

function requireConfirmation(args: Arguments, databaseName: string): void {
  if (optionalStringOption(args, "confirm-reset") !== databaseName) {
    throw new Error(`Command requires --confirm-reset=${databaseName}`);
  }
}

function parseArguments(values: string[]): Arguments {
  const result: Arguments = { _: [] };
  for (const value of values) {
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const separator = value.indexOf("=");
    if (separator === -1) result[value.slice(2)] = true;
    else result[value.slice(2, separator)] = value.slice(separator + 1);
  }
  return result;
}

function stringOption(args: Arguments, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name}=VALUE is required`);
  return value;
}

function optionalStringOption(args: Arguments, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} requires a value`);
  return value;
}

function integerOption(args: Arguments, name: string, fallback: number | undefined): number {
  const value = optionalStringOption(args, name);
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`--${name}=INTEGER is required`);
    return fallback;
  }
  return parseInteger(value, name);
}

function optionalIntegerOption(args: Arguments, name: string): number | undefined {
  const value = optionalStringOption(args, name);
  return value === undefined ? undefined : parseInteger(value, name);
}

function scenarioIdsOption(args: Arguments): ReadonlySet<string> | undefined {
  const value = optionalStringOption(args, "scenarios");
  if (value === undefined) return undefined;
  const ids = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("--scenarios requires at least one scenario ID");
  return new Set(ids);
}

function parseInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}

function printUsage(): void {
  console.log(`Usage: npm run benchmark:catalog -- <command> [options]\n
Commands:
  setup [--install-pg-trgm]
  load --songs=5000 --seed=${DEFAULT_SEED} --confirm-reset=NAME
  run [--warmups=${DEFAULT_WARMUPS}] [--repeats=${DEFAULT_REPEATS}] [--scenarios=ID,...] [--output=FILE]
  compare --candidate=NAME --confirm-reset=NAME [--scenarios=ID,...] [--output=FILE]
  matrix --confirm-reset=NAME [--sizes=5000,10000,20000] [--candidate=NAME] [--scenarios=ID,...]\n
Candidates: credit-artist, tag-relation, tag-alias-gin, public-latest, public-popular, catalog-trigram`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
