import { z } from "zod";

export const ENTITY_LIST_DEFAULT_PAGE_SIZE = 24;
export const ENTITY_LIST_MAX_PAGE_SIZE = 50;
export const ENTITY_LIST_MAX_PAGE = 10_000;
export const ENTITY_LIST_MAX_QUERY_LENGTH = 100;

const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive());

const schema = z.object({
  q: z.string().trim().max(ENTITY_LIST_MAX_QUERY_LENGTH)
    .transform((value) => value || undefined).optional(),
  page: positiveIntegerString.pipe(z.number().max(ENTITY_LIST_MAX_PAGE))
    .optional().default(1),
  pageSize: positiveIntegerString.pipe(z.number().max(ENTITY_LIST_MAX_PAGE_SIZE))
    .optional().default(ENTITY_LIST_DEFAULT_PAGE_SIZE),
});

export type EntityListQuery = z.output<typeof schema>;
export type EntityListSearchParams = Record<string, string | string[] | undefined>;
export type EntityListQueryResult =
  | { success: true; data: EntityListQuery }
  | { success: false };

export function parseEntityListQuery(
  input: URLSearchParams | EntityListSearchParams,
): EntityListQueryResult {
  const values: Record<string, string | undefined> = {};
  for (const key of ["q", "page", "pageSize"] as const) {
    if (input instanceof URLSearchParams) {
      const entries = input.getAll(key);
      if (entries.length > 1) return { success: false };
      values[key] = entries[0];
    } else {
      const value = input[key];
      if (Array.isArray(value)) return { success: false };
      values[key] = value;
    }
  }
  const result = schema.safeParse(values);
  if (!result.success) return { success: false };
  const { q, ...data } = result.data;
  return { success: true, data: q ? { ...data, q } : data };
}
