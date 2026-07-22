import type { PoolClient } from "pg";

export interface IndexCandidate {
  name: string;
  description: string;
  statements: readonly string[];
  indexes: readonly string[];
  requiredExtensions?: readonly string[];
}

const PREFIX = "bench_catalog_";

export const INDEX_CANDIDATES = {
  "credit-artist": {
    name: "credit-artist",
    description: "Reverse artist-credit lookup used by artist works queries",
    indexes: [`${PREFIX}credit_artist_song`],
    statements: [
      `CREATE INDEX ${PREFIX}credit_artist_song ON "SongArtistCredit" ("artistId", "songId") WHERE "artistId" IS NOT NULL`,
    ],
  },
  "tag-relation": {
    name: "tag-relation",
    description: "Reverse tag-song lookup used by tag search",
    indexes: [`${PREFIX}song_tag_tag_song`],
    statements: [
      `CREATE INDEX ${PREFIX}song_tag_tag_song ON "SongTag" ("tagId", "songId")`,
    ],
  },
  "tag-alias-gin": {
    name: "tag-alias-gin",
    description: "Exact membership lookup for tag additional names",
    indexes: [`${PREFIX}tag_additional_names_gin`],
    statements: [
      `CREATE INDEX ${PREFIX}tag_additional_names_gin ON "Tag" USING GIN ("additionalNames")`,
    ],
  },
  "public-latest": {
    name: "public-latest",
    description: "Public catalog visibility and latest ordering",
    indexes: [`${PREFIX}song_public_latest`],
    statements: [
      `CREATE INDEX ${PREFIX}song_public_latest ON "Song" ("publishDate" DESC NULLS LAST, "sourceCreatedAt" DESC, "id") WHERE NOT "sourceDeleted" AND "lastSyncedAt" IS NOT NULL AND "syncStatus" IN ('SYNCED', 'FAILED')`,
    ],
  },
  "public-popular": {
    name: "public-popular",
    description: "Public catalog visibility and popular ordering",
    indexes: [`${PREFIX}song_public_popular`],
    statements: [
      `CREATE INDEX ${PREFIX}song_public_popular ON "Song" ("favoritedTimes" DESC, "ratingScore" DESC, "publishDate" DESC NULLS LAST, "id") WHERE NOT "sourceDeleted" AND "lastSyncedAt" IS NOT NULL AND "syncStatus" IN ('SYNCED', 'FAILED')`,
    ],
  },
  "catalog-trigram": {
    name: "catalog-trigram",
    description: "Trigram acceleration for case-insensitive catalog text search",
    indexes: [
      `${PREFIX}song_name_trgm`,
      `${PREFIX}song_default_name_trgm`,
      `${PREFIX}song_artist_string_trgm`,
      `${PREFIX}song_name_value_trgm`,
      `${PREFIX}credit_name_trgm`,
      `${PREFIX}artist_name_trgm`,
      `${PREFIX}tag_name_trgm`,
    ],
    requiredExtensions: ["pg_trgm"],
    statements: [
      `CREATE INDEX ${PREFIX}song_name_trgm ON "Song" USING GIN ("name" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}song_default_name_trgm ON "Song" USING GIN ("defaultName" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}song_artist_string_trgm ON "Song" USING GIN ("artistString" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}song_name_value_trgm ON "SongName" USING GIN ("value" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}credit_name_trgm ON "SongArtistCredit" USING GIN ("name" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}artist_name_trgm ON "Artist" USING GIN ("name" gin_trgm_ops)`,
      `CREATE INDEX ${PREFIX}tag_name_trgm ON "Tag" USING GIN ("name" gin_trgm_ops)`,
    ],
  },
} as const satisfies Record<string, IndexCandidate>;

export type IndexCandidateName = keyof typeof INDEX_CANDIDATES;

export function getIndexCandidate(name: string): IndexCandidate {
  const candidate = (INDEX_CANDIDATES as Record<string, IndexCandidate>)[name];
  if (!candidate) {
    throw new Error(
      `Unknown candidate ${name}; expected one of: ${Object.keys(INDEX_CANDIDATES).join(", ")}`,
    );
  }
  return candidate;
}

export async function installCandidate(
  db: PoolClient,
  candidate: IndexCandidate,
): Promise<void> {
  await assertBenchmarkDatabase(db);
  await assertNoBenchmarkIndexes(db);

  for (const extension of candidate.requiredExtensions ?? []) {
    if (!/^[a-z0-9_]+$/.test(extension)) throw new Error(`Unsafe extension name: ${extension}`);
    await assertExtensionInstalled(db, extension);
  }
  for (const statement of candidate.statements) await db.query(statement);
  await db.query("ANALYZE");
}

export async function removeCandidate(
  db: PoolClient,
  candidate: IndexCandidate,
): Promise<void> {
  await assertBenchmarkDatabase(db);
  for (const name of candidate.indexes) {
    await db.query(`DROP INDEX IF EXISTS ${quoteIdentifier(name)}`);
  }
  await assertNoBenchmarkIndexes(db);
  await db.query("ANALYZE");
}

export async function cleanupBenchmarkIndexes(db: PoolClient): Promise<void> {
  await assertBenchmarkDatabase(db);
  const result = await db.query<{ schemaname: string; indexname: string }>(
    `SELECT schemaname, indexname
       FROM pg_indexes
      WHERE indexname LIKE $1
      ORDER BY schemaname, indexname`,
    [`${PREFIX}%`],
  );

  for (const { schemaname, indexname } of result.rows) {
    await db.query(`DROP INDEX IF EXISTS ${quoteIdentifier(schemaname)}.${quoteIdentifier(indexname)}`);
  }
  await assertNoBenchmarkIndexes(db);
}

export async function assertNoBenchmarkIndexes(db: PoolClient): Promise<void> {
  const result = await db.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE indexname LIKE $1 ORDER BY indexname",
    [`${PREFIX}%`],
  );
  if (result.rows.length > 0) {
    throw new Error(`Benchmark indexes already exist: ${result.rows.map(({ indexname }) => indexname).join(", ")}`);
  }
}

async function assertExtensionInstalled(db: PoolClient, extension: string): Promise<void> {
  const result = await db.query<{ installed: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS installed",
    [extension],
  );
  if (result.rows[0]?.installed !== true) {
    throw new Error(
      `Candidate ${extension} extension is not installed; install it explicitly in the benchmark database during setup`,
    );
  }
}

async function assertBenchmarkDatabase(db: PoolClient): Promise<void> {
  const result = await db.query<{ name: string }>("SELECT current_database() AS name");
  const name = result.rows[0]?.name;
  if (!name?.endsWith("_benchmark")) {
    throw new Error(`Refusing benchmark DDL on database ${name ?? "<unknown>"}`);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
