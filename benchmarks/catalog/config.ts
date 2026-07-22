const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const BENCHMARK_DATABASE_SUFFIX = "_benchmark";
const DEFAULT_CHUNK_SIZE = 1_000;
const MAX_CHUNK_SIZE = 5_000;

export type CatalogBenchmarkConfig = {
  connectionString: string;
  databaseName: string;
  databaseIdentity: string;
};

type Environment = Record<string, string | undefined>;

export function parseCatalogBenchmarkConfig(
  environment: Environment,
): CatalogBenchmarkConfig {
  const raw = environment.BENCHMARK_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error("BENCHMARK_DATABASE_URL is required");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("BENCHMARK_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new Error("BENCHMARK_DATABASE_URL must use PostgreSQL");
  }

  const databaseName = decodeDatabaseName(url.pathname);
  assertBenchmarkDatabaseName(databaseName, "BENCHMARK_DATABASE_URL");
  assertNoDatabaseAlias(environment, raw);

  return {
    connectionString: raw,
    databaseName,
    databaseIdentity: redactDatabaseIdentity(url, databaseName),
  };
}

export function assertBenchmarkDatabaseName(
  databaseName: string,
  source = "database",
): void {
  if (!databaseName.toLowerCase().endsWith(BENCHMARK_DATABASE_SUFFIX)) {
    throw new Error(`${source} name must end with ${BENCHMARK_DATABASE_SUFFIX}`);
  }
}

export function assertResetConfirmation(
  expectedDatabaseName: string,
  confirmation: string | undefined,
): void {
  if (confirmation !== expectedDatabaseName) {
    throw new Error(
      `reset requires --confirm-reset=${expectedDatabaseName}`,
    );
  }
}

export function parseChunkSize(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_CHUNK_SIZE;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CHUNK_SIZE) {
    throw new Error(`chunk size must be an integer between 1 and ${MAX_CHUNK_SIZE}`);
  }
  return parsed;
}

export function redactDatabaseIdentity(
  url: URL,
  databaseName = decodeDatabaseName(url.pathname),
): string {
  const host = url.hostname || "unknown-host";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}/${databaseName}`;
}

function decodeDatabaseName(pathname: string): string {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(pathname.replace(/^\//, ""));
  } catch {
    throw new Error("BENCHMARK_DATABASE_URL contains an invalid database name");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("BENCHMARK_DATABASE_URL must identify one database");
  }
  return databaseName;
}

function assertNoDatabaseAlias(
  environment: Environment,
  benchmarkUrl: string,
): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"] as const) {
    const candidate = environment[name]?.trim();
    if (!candidate) continue;
    if (sameDatabase(candidate, benchmarkUrl)) {
      throw new Error(`BENCHMARK_DATABASE_URL must not alias ${name}`);
    }
  }
}

function sameDatabase(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      normalizedProtocol(a.protocol) === normalizedProtocol(b.protocol) &&
      a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
      effectivePort(a) === effectivePort(b) &&
      decodeDatabaseName(a.pathname) === decodeDatabaseName(b.pathname)
    );
  } catch {
    return left === right;
  }
}

function normalizedProtocol(protocol: string): string {
  return protocol === "postgres:" ? "postgresql:" : protocol;
}

function effectivePort(url: URL): string {
  return url.port || "5432";
}
