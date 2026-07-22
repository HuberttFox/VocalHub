import type { CapturedQuery } from "./measure";

export interface ExplainPlan {
  fingerprint: string;
  planningTimeMs: number | null;
  executionTimeMs: number | null;
  plan: unknown;
}

export interface ExplainQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

interface PostgresExplainDocument {
  Plan?: unknown;
  "Planning Time"?: number;
  "Execution Time"?: number;
}

const READ_QUERY = /^\s*(?:select|with)\b/i;
const MULTIPLE_STATEMENTS = /;\s*\S/;

/** Replays a captured Prisma read query with the exact bound parameters. */
export async function explainCapturedQuery(
  db: ExplainQueryable,
  query: CapturedQuery,
): Promise<ExplainPlan | null> {
  if (!isExplainableRead(query.sql)) return null;

  const result = await db.query<{ "QUERY PLAN": unknown }>(
    `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON, TIMING FALSE) ${query.sql}`,
    query.params,
  );
  const document = unwrapExplain(result.rows[0]?.["QUERY PLAN"]);

  return {
    fingerprint: query.fingerprint,
    planningTimeMs: numberOrNull(document["Planning Time"]),
    executionTimeMs: numberOrNull(document["Execution Time"]),
    plan: document.Plan ?? null,
  };
}

export async function explainCapturedQueries(
  db: ExplainQueryable,
  queries: readonly CapturedQuery[],
): Promise<ExplainPlan[]> {
  const unique = new Map<string, CapturedQuery>();
  for (const query of queries) {
    if (isExplainableRead(query.sql) && !unique.has(query.fingerprint)) {
      unique.set(query.fingerprint, query);
    }
  }

  const plans: ExplainPlan[] = [];
  for (const query of unique.values()) {
    const plan = await explainCapturedQuery(db, query);
    if (plan) plans.push(plan);
  }
  return plans;
}

export function isExplainableRead(sql: string): boolean {
  const withoutComments = sql.replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, "");
  return READ_QUERY.test(withoutComments) && !MULTIPLE_STATEMENTS.test(withoutComments);
}

function unwrapExplain(value: unknown): PostgresExplainDocument {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (Array.isArray(parsed)) parsed = parsed[0];

  if (!parsed || typeof parsed !== "object") {
    throw new Error("PostgreSQL returned an invalid EXPLAIN JSON document");
  }
  return parsed as PostgresExplainDocument;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
