import type { PoolClient } from "pg";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  assertBenchmarkDatabaseName,
  assertResetConfirmation,
  parseChunkSize,
  type CatalogBenchmarkConfig,
} from "./config";
import {
  createCatalogBenchmarkMarker,
  generateCatalogBenchmarkArtists,
  generateCatalogBenchmarkChunk,
  generateCatalogBenchmarkTags,
  assertCatalogBenchmarkDatasetOptions,
} from "./dataset";
import {
  CATALOG_BENCHMARK_DATASET_VERSION,
  type CatalogBenchmarkLoadOptions,
  type CatalogBenchmarkLoadResult,
  type CatalogBenchmarkMarker,
} from "./types";

const BENCHMARK_LOCK_KEYS = [0x564f4341, 0x54434c49] as const;
const METADATA_TABLE = "_CatalogBenchmarkMetadata";

type CatalogTableCounts = {
  songCount: number;
  artistCount: number;
  tagCount: number;
  nameCount: number;
  creditCount: number;
  songTagCount: number;
};

export async function assertCatalogBenchmarkServerDatabase(
  db: PrismaClient,
  config: CatalogBenchmarkConfig,
): Promise<string> {
  const rows = await db.$queryRaw<Array<{ databaseName: string }>>`
    SELECT current_database() AS "databaseName"
  `;
  const serverDatabaseName = rows[0]?.databaseName;
  if (!serverDatabaseName) {
    throw new Error("PostgreSQL did not report current_database()");
  }
  assertBenchmarkDatabaseName(serverDatabaseName, "server database");
  if (serverDatabaseName !== config.databaseName) {
    throw new Error(
      `server database does not match BENCHMARK_DATABASE_URL (${config.databaseIdentity})`,
    );
  }
  return serverDatabaseName;
}

type CatalogBenchmarkLockClient = Pick<PoolClient, "query">;

export async function acquireCatalogBenchmarkLock(
  db: CatalogBenchmarkLockClient,
): Promise<void> {
  const result = await db.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
    [...BENCHMARK_LOCK_KEYS],
  );
  if (result.rows[0]?.acquired !== true) {
    throw new Error("another catalog benchmark process holds the database lock");
  }
}

export async function releaseCatalogBenchmarkLock(
  db: CatalogBenchmarkLockClient,
): Promise<void> {
  await db.query(
    "SELECT pg_advisory_unlock($1::integer, $2::integer)",
    [...BENCHMARK_LOCK_KEYS],
  );
}

export async function withCatalogBenchmarkLock<T>(
  db: CatalogBenchmarkLockClient,
  operation: () => Promise<T>,
): Promise<T> {
  await acquireCatalogBenchmarkLock(db);
  try {
    return await operation();
  } finally {
    await releaseCatalogBenchmarkLock(db);
  }
}

export async function loadCatalogBenchmark(
  db: PrismaClient,
  lockClient: CatalogBenchmarkLockClient,
  config: CatalogBenchmarkConfig,
  options: CatalogBenchmarkLoadOptions,
): Promise<CatalogBenchmarkLoadResult> {
  assertCatalogBenchmarkDatasetOptions(options);
  assertResetConfirmation(config.databaseName, options.confirmReset);
  const chunkSize = parseChunkSize(options.chunkSize);

  return withCatalogBenchmarkLock(lockClient, async () => {
    await assertCatalogBenchmarkServerDatabase(db, config);
    await ensureMetadataTable(db);
    await resetCatalogTables(db);

    const marker = createCatalogBenchmarkMarker(options);
    const artists = generateCatalogBenchmarkArtists(options);
    const tags = generateCatalogBenchmarkTags(options);
    await createManyInChunks(artists, chunkSize, (data) =>
      db.artist.createMany({ data }),
    );
    await createManyInChunks(tags, chunkSize, (data) =>
      db.tag.createMany({ data }),
    );

    for (let start = 0; start < options.songCount; start += chunkSize) {
      const chunk = generateCatalogBenchmarkChunk({
        ...options,
        start,
        count: Math.min(chunkSize, options.songCount - start),
      });
      await db.$transaction(async (tx) => {
        await tx.song.createMany({ data: chunk.songs });
        await tx.songName.createMany({ data: chunk.names });
        await tx.songArtistCredit.createMany({ data: chunk.credits });
        await tx.songTag.createMany({ data: chunk.songTags });
      });
    }

    const actual = await readCatalogTableCounts(db);
    assertMarkerCounts(marker, actual);
    await writeMarker(db, marker);
    await analyzeCatalogTables(db);
    return marker;
  });
}

export async function resetCatalogTables(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SongPV",
      "SongTag",
      "SongArtistCredit",
      "SongName",
      "Tag",
      "Artist",
      "Song"
    RESTART IDENTITY
  `);
  await db.$executeRawUnsafe(`TRUNCATE TABLE "${METADATA_TABLE}"`);
}

export async function readCatalogBenchmarkMarker(
  db: PrismaClient,
): Promise<CatalogBenchmarkMarker | null> {
  await ensureMetadataTable(db);
  const rows = await db.$queryRawUnsafe<Array<{ value: unknown }>>(
    `SELECT "value" FROM "${METADATA_TABLE}" WHERE "key" = $1`,
    "dataset",
  );
  const value = rows[0]?.value;
  if (!isMarker(value)) return null;
  const actual = await readCatalogTableCounts(db);
  assertMarkerCounts(value, actual);
  return value;
}

async function ensureMetadataTable(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${METADATA_TABLE}" (
      "key" TEXT PRIMARY KEY,
      "value" JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function writeMarker(
  db: PrismaClient,
  marker: CatalogBenchmarkMarker,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO "${METADATA_TABLE}" ("key", "value") VALUES ($1, $2::jsonb)`,
    "dataset",
    JSON.stringify(marker),
  );
}

async function readCatalogTableCounts(db: PrismaClient): Promise<CatalogTableCounts> {
  const rows = await db.$queryRaw<Array<CatalogTableCounts>>`
    SELECT
      (SELECT count(*)::integer FROM "Song") AS "songCount",
      (SELECT count(*)::integer FROM "Artist") AS "artistCount",
      (SELECT count(*)::integer FROM "Tag") AS "tagCount",
      (SELECT count(*)::integer FROM "SongName") AS "nameCount",
      (SELECT count(*)::integer FROM "SongArtistCredit") AS "creditCount",
      (SELECT count(*)::integer FROM "SongTag") AS "songTagCount"
  `;
  const counts = rows[0];
  if (!counts) throw new Error("PostgreSQL did not report benchmark table counts");
  return counts;
}

function assertMarkerCounts(
  marker: CatalogBenchmarkMarker,
  actual: CatalogTableCounts,
): void {
  const expected: CatalogTableCounts = {
    songCount: marker.songCount,
    artistCount: marker.artistCount,
    tagCount: marker.tagCount,
    nameCount: marker.nameCount,
    creditCount: marker.creditCount,
    songTagCount: marker.songTagCount,
  };
  for (const key of Object.keys(expected) as Array<keyof CatalogTableCounts>) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `benchmark dataset marker is stale: ${key} expected ${expected[key]}, found ${actual[key]}`,
      );
    }
  }
}

async function analyzeCatalogTables(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    ANALYZE "Song", "SongName", "Artist", "SongArtistCredit", "Tag", "SongTag"
  `);
}

async function createManyInChunks<T>(
  rows: T[],
  chunkSize: number,
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    await insert(rows.slice(start, start + chunkSize));
  }
}

function isMarker(value: unknown): value is CatalogBenchmarkMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<CatalogBenchmarkMarker>;
  return (
    marker.kind === "vocalhub-catalog-benchmark" &&
    marker.version === CATALOG_BENCHMARK_DATASET_VERSION &&
    typeof marker.seed === "number" &&
    typeof marker.songCount === "number" &&
    typeof marker.artistCount === "number" &&
    typeof marker.tagCount === "number" &&
    typeof marker.nameCount === "number" &&
    typeof marker.creditCount === "number" &&
    typeof marker.songTagCount === "number" &&
    isRecord(marker.visibility) &&
    isRecord(marker.searchMarkers) &&
    isRecord(marker.artistMarkers) &&
    typeof marker.checksum === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
