#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { listArtistWorks } from "@/lib/artists/repository";
import { listArtists } from "@/lib/artists/list-repository";
import { listTags, listTagSongs } from "@/lib/tags/repository";
import { searchCatalog } from "@/lib/search/repository";
import { listSongs, listSongsWithBroadSearch } from "@/lib/songs/repository";
import { listSongsWithDecomposedSearch } from "@/lib/songs/search-query";
import { getDiscovery } from "@/lib/discover/repository";
import { getDiscoveryV2 } from "@/lib/discover/discovery-v2";
import type { DiscoveryDto } from "@/lib/discover/dto";
import {
  getDiscoveryWithCombinedCte,
  getDiscoveryWithSplitCount,
} from "@/lib/discover/shape-query";
import {
  measureAlternatingStateSuite,
  measurePairedAlternating,
  pairOrder,
  summarizePairedMeasurements,
  type PairedComparison,
} from "./compare";
import { parseCatalogBenchmarkConfig } from "./config";
import {
  createCatalogBenchmarkClient,
  createCatalogQueryEventCollector,
} from "./db";
import { explainCapturedQueries } from "./explain";
import {
  assertNoBenchmarkIndexes,
  cleanupBenchmarkIndexes,
  getIndexCandidate,
  INDEX_CANDIDATES,
  installCandidate,
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
  printReport,
  toReportScenario,
  writeReport,
  type BenchmarkReport,
  type PairedComparisonReport,
  type ReportRun,
} from "./report";
import {
  catalogBenchmarkResultChecksum,
  checkCatalogBenchmarkResult,
  defineCatalogBenchmarkScenarios,
  type CatalogBenchmarkScenario,
  type CatalogBenchmarkScenarioResult,
} from "./scenarios";
import {
  CATALOG_BENCHMARK_TARGET_SONGS,
  type CatalogBenchmarkMarker,
} from "./types";

const DEFAULT_SEED = 20_260_720;
const DEFAULT_WARMUPS = 3;
const DEFAULT_REPEATS = 15;
const DEFAULT_CYCLES = 8;
const DEFAULT_BLOCK_REPEATS = 3;
const REQUIRED_MATRIX_SIZES = [5_000, 10_000, 20_000, 50_000] as const;
const DEFAULT_SIZES = REQUIRED_MATRIX_SIZES;
const CLI_LOCK_KEYS = [0x564f4341, 0x54434c49];

const DISCOVERY_SHAPES = {
  "combined-cte": getDiscoveryWithCombinedCte,
  "split-count": getDiscoveryWithSplitCount,
} as const;
type DiscoveryShapeName = keyof typeof DISCOVERY_SHAPES;

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

    case "compare-search-shape": {
      const report = await runLockedSearchShapeComparison(
        config.connectionString,
        config.databaseName,
        config.databaseIdentity,
        integerOption(args, "warmups", DEFAULT_WARMUPS),
        integerOption(args, "repeats", DEFAULT_REPEATS),
        scenarioIdsOption(args),
      );
      await emitReport(report, optionalStringOption(args, "output"));
      return;
    }

    case "compare-discovery-shape": {
      const shape = stringOption(args, "candidate");
      if (!(shape in DISCOVERY_SHAPES)) {
        throw new Error(`Unknown discovery shape ${shape}; expected ${Object.keys(DISCOVERY_SHAPES).join(", ")}`);
      }
      const report = await runLockedDiscoveryShapeComparison(
        config.connectionString,
        config.databaseName,
        config.databaseIdentity,
        shape as DiscoveryShapeName,
        integerOption(args, "warmups", DEFAULT_WARMUPS),
        integerOption(args, "repeats", DEFAULT_REPEATS),
        scenarioIdsOption(args),
      );
      await emitReport(report, optionalStringOption(args, "output"));
      return;
    }

    case "compare-discovery-algorithm": {
      const report = await runLockedDiscoveryAlgorithmComparison(
        config.connectionString,
        config.databaseName,
        config.databaseIdentity,
        integerOption(args, "warmups", DEFAULT_WARMUPS),
        integerOption(args, "repeats", DEFAULT_REPEATS),
        scenarioIdsOption(args),
      );
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
        integerOption(args, "warmups", 1),
        integerOption(args, "cycles", DEFAULT_CYCLES),
        integerOption(args, "block-repeats", DEFAULT_BLOCK_REPEATS),
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
  if (!sizes.some((size) => size >= CATALOG_BENCHMARK_TARGET_SONGS)) {
    throw new Error(`matrix requires --sizes to include target scale >= ${CATALOG_BENCHMARK_TARGET_SONGS}`);
  }
  for (const requiredSize of REQUIRED_MATRIX_SIZES) {
    if (!sizes.includes(requiredSize)) {
      throw new Error(`matrix requires --sizes to include ${REQUIRED_MATRIX_SIZES.join(",")}`);
    }
  }
  const candidateName = optionalStringOption(args, "candidate");
  const outputDirectory = optionalStringOption(args, "output-dir") ?? ".benchmark-results";
  const seed = integerOption(args, "seed", DEFAULT_SEED);
  const warmups = integerOption(args, "warmups", DEFAULT_WARMUPS);
  const repeats = integerOption(args, "repeats", DEFAULT_REPEATS);
  const cycles = integerOption(args, "cycles", DEFAULT_CYCLES);
  const blockRepeats = integerOption(args, "block-repeats", DEFAULT_BLOCK_REPEATS);
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
          cycles,
          blockRepeats,
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

async function runLockedSearchShapeComparison(
  connectionString: string,
  databaseName: string,
  databaseIdentity: string,
  warmups: number,
  repeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await assertNoBenchmarkIndexes(pg);
      const db = createCatalogBenchmarkClient(connectionString);
      try {
        const marker = await requireMarker(db);
        const scenarios = defineCatalogBenchmarkScenarios({ marker }, scenarioIds)
          .filter((scenario): scenario is Extract<CatalogBenchmarkScenario, { kind: "songs" }> =>
            scenario.kind === "songs" && Boolean(scenario.query.q));
        if (scenarios.length === 0) throw new Error("No search benchmark scenarios selected");

        const reports: PairedComparisonReport["scenarios"] = [];
        for (const scenario of scenarios) {
          reports.push(await compareSearchScenario(
            connectionString,
            pg,
            scenario,
            warmups,
            repeats,
          ));
        }

        return {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          command: "compare-search-shape",
          dataset: marker,
          environment: {
            database: databaseIdentity,
            node: process.version,
            platform: process.platform,
          },
          runs: [],
          pairedComparison: {
            kind: "search-shape",
            candidate: "relation-branch-union",
            scenarios: reports,
          },
        };
      } finally {
        await db.$disconnect();
      }
    }),
  );
}

async function compareSearchScenario(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "songs" }>,
  warmups: number,
  repeats: number,
): Promise<PairedComparisonReport["scenarios"][number]> {
  const aDb = createCatalogBenchmarkClient(connectionString);
  const bDb = createCatalogBenchmarkClient(connectionString);
  let resultDigest = "";

  try {
    const comparison: PairedComparison = await measurePairedAlternating({
      a: {
        warmups,
        run: () => listSongsWithBroadSearch(scenario.query, aDb),
      },
      b: {
        warmups,
        run: () => listSongsWithDecomposedSearch(scenario.query, bDb),
      },
      repeats,
      digest: (result) => checkCatalogBenchmarkResult(scenario, result).checksum,
      observePair: ({ aValue }) => {
        resultDigest = checkCatalogBenchmarkResult(scenario, aValue).checksum;
      },
    });

    const aEvidence = await captureSongSearchEvidence(
      connectionString,
      pg,
      scenario,
      "broad",
    );
    const bEvidence = await captureSongSearchEvidence(
      connectionString,
      pg,
      scenario,
      "decomposed",
    );

    return {
      name: scenario.id,
      warmups,
      repeats,
      pairs: comparison.pairs,
      summary: comparison.summary,
      resultDigest,
      aQueries: reportQueries(aEvidence.queries),
      bQueries: reportQueries(bEvidence.queries),
      aExplains: aEvidence.explains,
      bExplains: bEvidence.explains,
    };
  } finally {
    await Promise.all([aDb.$disconnect(), bDb.$disconnect()]);
  }
}

async function captureSongSearchEvidence(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "songs" }>,
  strategy: "broad" | "decomposed",
): Promise<{ queries: Map<string, CapturedQuery>; explains: Awaited<ReturnType<typeof explainCapturedQueries>> }> {
  const collector = createCatalogQueryEventCollector();
  const db = createCatalogBenchmarkClient(connectionString, collector.onQuery);
  const capture = collectorCapture(collector);
  try {
    capture.start();
    if (strategy === "broad") await listSongsWithBroadSearch(scenario.query, db);
    else await listSongsWithDecomposedSearch(scenario.query, db);
    const queries = new Map<string, CapturedQuery>();
    collectQueries(capture.stop(), queries);
    return { queries, explains: await explainCapturedQueries(pg, [...queries.values()]) };
  } finally {
    await db.$disconnect();
  }
}

function collectQueries(
  queries: CapturedQuery[],
  destination: Map<string, CapturedQuery>,
): void {
  for (const query of queries) destination.set(query.fingerprint, query);
}

function reportQueries(
  queries: ReadonlyMap<string, CapturedQuery>,
): PairedComparisonReport["scenarios"][number]["aQueries"] {
  return [...queries.values()].map(({ fingerprint, durationMs }) => ({
    fingerprint,
    durationMs,
  }));
}

async function runLockedDiscoveryShapeComparison(
  connectionString: string,
  databaseName: string,
  databaseIdentity: string,
  shape: DiscoveryShapeName,
  warmups: number,
  repeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await assertNoBenchmarkIndexes(pg);
      const db = createCatalogBenchmarkClient(connectionString);
      try {
        const marker = await requireMarker(db);
        const scenarios = defineCatalogBenchmarkScenarios({ marker }, scenarioIds)
          .filter((scenario): scenario is Extract<CatalogBenchmarkScenario, { kind: "discovery" }> =>
            scenario.kind === "discovery");
        if (scenarios.length === 0) throw new Error("No discovery benchmark scenarios selected");

        const reports: PairedComparisonReport["scenarios"] = [];
        for (const scenario of scenarios) {
          reports.push(await compareDiscoveryScenario(
            connectionString,
            pg,
            scenario,
            shape,
            warmups,
            repeats,
          ));
        }

        return {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          command: "compare-discovery-shape",
          dataset: marker,
          environment: {
            database: databaseIdentity,
            node: process.version,
            platform: process.platform,
          },
          runs: [],
          pairedComparison: {
            kind: "discovery-shape",
            candidate: shape,
            scenarios: reports,
          },
        };
      } finally {
        await db.$disconnect();
      }
    }),
  );
}

async function compareDiscoveryScenario(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "discovery" }>,
  shape: DiscoveryShapeName,
  warmups: number,
  repeats: number,
): Promise<PairedComparisonReport["scenarios"][number]> {
  const aDb = createCatalogBenchmarkClient(connectionString);
  const bDb = createCatalogBenchmarkClient(connectionString);
  let resultDigest = "";

  try {
    const comparison: PairedComparison = await measurePairedAlternating({
      a: {
        warmups,
        run: () => getDiscovery(scenario.viewerId, scenario.query, aDb),
      },
      b: {
        warmups,
        run: () => DISCOVERY_SHAPES[shape](scenario.viewerId, scenario.query, bDb),
      },
      repeats,
      digest: (result) => checkCatalogBenchmarkResult(scenario, result).checksum,
      observePair: ({ aValue }) => {
        resultDigest = checkCatalogBenchmarkResult(scenario, aValue).checksum;
      },
    });

    const aEvidence = await captureDiscoveryEvidence(connectionString, pg, scenario, "window");
    const bEvidence = await captureDiscoveryEvidence(connectionString, pg, scenario, shape);

    return {
      name: scenario.id,
      warmups,
      repeats,
      pairs: comparison.pairs,
      summary: comparison.summary,
      resultDigest,
      aQueries: reportQueries(aEvidence.queries),
      bQueries: reportQueries(bEvidence.queries),
      aExplains: aEvidence.explains,
      bExplains: bEvidence.explains,
    };
  } finally {
    await Promise.all([aDb.$disconnect(), bDb.$disconnect()]);
  }
}

async function runLockedDiscoveryAlgorithmComparison(
  connectionString: string,
  databaseName: string,
  databaseIdentity: string,
  warmups: number,
  repeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await assertNoBenchmarkIndexes(pg);
      const db = createCatalogBenchmarkClient(connectionString);
      try {
        const marker = await requireMarker(db);
        const scenarios = defineCatalogBenchmarkScenarios({ marker }, scenarioIds)
          .filter((scenario): scenario is Extract<CatalogBenchmarkScenario, { kind: "discovery" }> =>
            scenario.kind === "discovery" && scenario.query.page === 1);
        if (scenarios.length === 0) throw new Error("No first-page discovery benchmark scenarios selected");

        const reports: PairedComparisonReport["scenarios"] = [];
        for (const scenario of scenarios) {
          reports.push(await compareDiscoveryAlgorithmScenario(
            connectionString,
            pg,
            scenario,
            warmups,
            repeats,
          ));
        }

        return {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          command: "compare-discovery-algorithm",
          dataset: marker,
          environment: {
            database: databaseIdentity,
            node: process.version,
            platform: process.platform,
          },
          runs: [],
          pairedComparison: {
            kind: "discovery-algorithm",
            candidate: "bounded-candidate-v2",
            scenarios: reports,
          },
        };
      } finally {
        await db.$disconnect();
      }
    }),
  );
}

async function compareDiscoveryAlgorithmScenario(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "discovery" }>,
  warmups: number,
  repeats: number,
): Promise<PairedComparisonReport["scenarios"][number]> {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error("repeats must be a positive integer");
  }

  const aDb = createCatalogBenchmarkClient(connectionString);
  const bDb = createCatalogBenchmarkClient(connectionString);
  const aDigests = new Set<string>();
  const bDigests = new Set<string>();

  const runA = async (): Promise<number> => {
    const startedAt = performance.now();
    const result = await getDiscovery(scenario.viewerId, scenario.query, aDb);
    aDigests.add(checkCatalogBenchmarkResult(scenario, result).checksum);
    return performance.now() - startedAt;
  };
  const runB = async (): Promise<number> => {
    const startedAt = performance.now();
    const result = await getDiscoveryV2(scenario.viewerId, scenario.query, bDb);
    assertV2DiscoveryContract(scenario, result);
    bDigests.add(catalogBenchmarkResultChecksum(result));
    return performance.now() - startedAt;
  };

  try {
    for (let pairIndex = 0; pairIndex < warmups; pairIndex += 1) {
      if (pairOrder(pairIndex) === "AB") {
        await runA();
        await runB();
      } else {
        await runB();
        await runA();
      }
    }

    const pairs = [];
    for (let pairIndex = 0; pairIndex < repeats; pairIndex += 1) {
      const order = pairOrder(pairIndex);
      const [aDurationMs, bDurationMs] = order === "AB"
        ? [await runA(), await runB()]
        : [await runB(), await runA()];
      pairs.push({
        pairIndex,
        order,
        aDurationMs,
        bDurationMs,
        bChangePercent: aDurationMs === 0 ? 0 : ((bDurationMs - aDurationMs) / aDurationMs) * 100,
      });
    }

    assertSingleDiscoveryDigest("V1", scenario.id, aDigests);
    assertSingleDiscoveryDigest("V2", scenario.id, bDigests);
    const aEvidence = await captureDiscoveryAlgorithmEvidence(connectionString, pg, scenario, "v1");
    const bEvidence = await captureDiscoveryAlgorithmEvidence(connectionString, pg, scenario, "v2");

    return {
      name: scenario.id,
      warmups,
      repeats,
      pairs,
      summary: summarizePairedMeasurements(pairs),
      resultDigest: [...aDigests][0]!,
      aResultDigest: [...aDigests][0]!,
      bResultDigest: [...bDigests][0]!,
      aDeterministic: true,
      bDeterministic: true,
      aQueries: reportQueries(aEvidence.queries),
      bQueries: reportQueries(bEvidence.queries),
      aExplains: aEvidence.explains,
      bExplains: bEvidence.explains,
    };
  } finally {
    await Promise.all([aDb.$disconnect(), bDb.$disconnect()]);
  }
}

function assertSingleDiscoveryDigest(algorithm: string, scenario: string, digests: ReadonlySet<string>): void {
  if (digests.size !== 1) {
    throw new Error(`${algorithm} discovery result was not deterministic for ${scenario}`);
  }
}

function assertV2DiscoveryContract(
  scenario: Extract<CatalogBenchmarkScenario, { kind: "discovery" }>,
  result: DiscoveryDto,
): void {
  if (result.algorithmVersion !== scenario.expectedAlgorithmVersion) {
    throw new Error(`Scenario ${scenario.id} returned unexpected V2 discovery version`);
  }
  const expectedItemCount = Math.max(
    0,
    Math.min(
      result.pagination.pageSize,
      result.pagination.totalItems - (result.pagination.page - 1) * result.pagination.pageSize,
    ),
  );
  if (
    result.pagination.page !== scenario.query.page
    || result.pagination.pageSize !== scenario.query.pageSize
    || result.items.length !== expectedItemCount
    || result.pagination.totalPages !== Math.ceil(result.pagination.totalItems / result.pagination.pageSize)
  ) {
    throw new Error(`Scenario ${scenario.id} returned inconsistent V2 discovery pagination`);
  }
}

async function captureDiscoveryAlgorithmEvidence(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "discovery" }>,
  algorithm: "v1" | "v2",
): Promise<{ queries: Map<string, CapturedQuery>; explains: Awaited<ReturnType<typeof explainCapturedQueries>> }> {
  const collector = createCatalogQueryEventCollector();
  const db = createCatalogBenchmarkClient(connectionString, collector.onQuery);
  const capture = collectorCapture(collector);
  try {
    capture.start();
    if (algorithm === "v1") await getDiscovery(scenario.viewerId, scenario.query, db);
    else await getDiscoveryV2(scenario.viewerId, scenario.query, db);
    const queries = new Map<string, CapturedQuery>();
    collectQueries(capture.stop(), queries);
    return { queries, explains: await explainCapturedQueries(pg, [...queries.values()]) };
  } finally {
    await db.$disconnect();
  }
}

async function captureDiscoveryEvidence(
  connectionString: string,
  pg: PoolClient,
  scenario: Extract<CatalogBenchmarkScenario, { kind: "discovery" }>,
  shape: DiscoveryShapeName | "window",
): Promise<{ queries: Map<string, CapturedQuery>; explains: Awaited<ReturnType<typeof explainCapturedQueries>> }> {
  const collector = createCatalogQueryEventCollector();
  const db = createCatalogBenchmarkClient(connectionString, collector.onQuery);
  const capture = collectorCapture(collector);
  try {
    capture.start();
    if (shape === "window") await getDiscovery(scenario.viewerId, scenario.query, db);
    else await DISCOVERY_SHAPES[shape](scenario.viewerId, scenario.query, db);
    const queries = new Map<string, CapturedQuery>();
    collectQueries(capture.stop(), queries);
    return {
      queries,
      explains: await explainCapturedQueries(pg, [...queries.values()]),
    };
  } finally {
    await db.$disconnect();
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
  cycles: number,
  blockRepeats: number,
  scenarioIds?: ReadonlySet<string>,
): Promise<BenchmarkReport> {
  return withPgClient(connectionString, (pg) =>
    withAdvisoryLock(pg, async () => {
      await assertConnectedDatabase(pg, databaseName);
      await cleanupBenchmarkIndexes(pg);

      const metadataDb = createCatalogBenchmarkClient(connectionString);
      try {
        const marker = await requireMarker(metadataDb);
        const scenarios = defineCatalogBenchmarkScenarios({ marker }, scenarioIds);
        if (scenarios.length === 0) throw new Error("No benchmark scenarios selected");
        const reports = await compareIndexScenarios(
          connectionString,
          pg,
          candidate,
          scenarios,
          warmups,
          cycles,
          blockRepeats,
        );

        await cleanupBenchmarkIndexes(pg);
        return {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          command: "compare",
          dataset: marker,
          environment: {
            database: databaseIdentity,
            node: process.version,
            platform: process.platform,
          },
          runs: [],
          pairedComparison: {
            kind: "index",
            candidate: candidate.name,
            scenarios: reports,
          },
        };
      } finally {
        await cleanupBenchmarkIndexes(pg);
        await metadataDb.$disconnect();
      }
    }),
  );
}

async function compareIndexScenarios(
  connectionString: string,
  pg: PoolClient,
  candidate: IndexCandidate,
  scenarios: readonly CatalogBenchmarkScenario[],
  warmups: number,
  cycles: number,
  blockRepeats: number,
): Promise<PairedComparisonReport["scenarios"]> {
  const db = createCatalogBenchmarkClient(connectionString);
  let state: "A" | "B" | null = null;

  const setState = async (next: "A" | "B") => {
    if (state === next) return;
    await cleanupBenchmarkIndexes(pg);
    if (next === "B") await installCandidate(pg, candidate);
    else await pg.query("ANALYZE");
    state = next;
  };

  try {
    const comparisons = await measureAlternatingStateSuite({
      cycles,
      blockRepeats,
      warmups,
      items: scenarios,
      key: ({ id }) => id,
      setState,
      prepareState: async () => {
        await pg.query("DISCARD PLANS");
      },
      run: (scenario) => runScenario(db, scenario),
      digest: (result) => catalogBenchmarkResultChecksum(result as Exclude<CatalogBenchmarkScenarioResult, null>),
    });

    const reports: PairedComparisonReport["scenarios"] = [];
    for (const scenario of scenarios) {
      const comparison = comparisons.get(scenario.id);
      if (!comparison) throw new Error(`Missing state comparison for ${scenario.id}`);
      const sample = await runScenario(db, scenario);
      const resultDigest = checkCatalogBenchmarkResult(scenario, sample).checksum;
      const aEvidence = await captureScenarioEvidence(
        connectionString,
        pg,
        scenario,
        () => setState("A"),
      );
      const bEvidence = await captureScenarioEvidence(
        connectionString,
        pg,
        scenario,
        () => setState("B"),
      );
      reports.push({
        name: scenario.id,
        warmups,
        repeats: blockRepeats,
        pairs: comparison.pairs,
        summary: comparison.summary,
        resultDigest,
        aQueries: reportQueries(aEvidence.queries),
        bQueries: reportQueries(bEvidence.queries),
        aExplains: aEvidence.explains,
        bExplains: bEvidence.explains,
      });
    }
    await setState("A");
    return reports;
  } finally {
    await cleanupBenchmarkIndexes(pg);
    await db.$disconnect();
  }
}

async function captureScenarioEvidence(
  connectionString: string,
  pg: PoolClient,
  scenario: CatalogBenchmarkScenario,
  prepare: () => Promise<void>,
): Promise<{ queries: Map<string, CapturedQuery>; explains: Awaited<ReturnType<typeof explainCapturedQueries>> }> {
  await prepare();
  const collector = createCatalogQueryEventCollector();
  const db = createCatalogBenchmarkClient(connectionString, collector.onQuery);
  const capture = collectorCapture(collector);
  try {
    capture.start();
    await runScenario(db, scenario);
    const queries = new Map<string, CapturedQuery>();
    collectQueries(capture.stop(), queries);
    return {
      queries,
      explains: await explainCapturedQueries(pg, [...queries.values()]),
    };
  } finally {
    await db.$disconnect();
  }
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
  db: Parameters<typeof listSongs>[1] & Parameters<typeof listArtistWorks>[2] & Parameters<typeof listArtists>[1] & Parameters<typeof listTags>[1] & Parameters<typeof listTagSongs>[2],
  scenario: CatalogBenchmarkScenario,
): Promise<CatalogBenchmarkScenarioResult> {
  switch (scenario.kind) {
    case "songs":
      return listSongs(scenario.query, db);
    case "artist-works":
      return listArtistWorks(scenario.artistId, scenario.query, db);
    case "tag-works":
      return listTagSongs(scenario.tagId, scenario.query, db);
    case "artist-list":
      return listArtists(scenario.query, db);
    case "tag-list":
      return listTags(scenario.query, db);
    case "search-catalog":
      return searchCatalog(scenario.term, db);
    case "discovery":
      return getDiscovery(scenario.viewerId, scenario.query, db);
    default:
      throw new Error("Unsupported benchmark scenario kind");
  }
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

async function requireMarker(
  db: Parameters<typeof readCatalogBenchmarkMarker>[0],
): Promise<CatalogBenchmarkMarker> {
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
  compare-search-shape [--warmups=${DEFAULT_WARMUPS}] [--repeats=${DEFAULT_REPEATS}] [--scenarios=ID,...] [--output=FILE]
  compare-discovery-shape --candidate=combined-cte|split-count [--warmups=${DEFAULT_WARMUPS}] [--repeats=${DEFAULT_REPEATS}] [--scenarios=ID,...] [--output=FILE]
  compare-discovery-algorithm [--warmups=${DEFAULT_WARMUPS}] [--repeats=${DEFAULT_REPEATS}] [--scenarios=ID,...] [--output=FILE]
  compare --candidate=NAME --confirm-reset=NAME [--cycles=${DEFAULT_CYCLES}] [--block-repeats=${DEFAULT_BLOCK_REPEATS}] [--scenarios=ID,...] [--output=FILE]
  matrix --confirm-reset=NAME [--sizes=5000,10000,20000,50000] [--candidate=NAME] [--scenarios=ID,...]\n
Candidates: ${Object.keys(INDEX_CANDIDATES).join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
