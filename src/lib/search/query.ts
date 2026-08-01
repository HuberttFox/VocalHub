import { z } from "zod";

export const SEARCH_PREVIEW_LIMIT = 6;
export const SEARCH_MAX_QUERY_LENGTH = 100;

const schema = z.object({
  q: z.string().trim().max(SEARCH_MAX_QUERY_LENGTH)
    .transform((value) => value || undefined).optional(),
});

export type SearchQuery = z.output<typeof schema>;
export type SearchParams = Record<string, string | string[] | undefined>;
export type SearchQueryResult =
  | { success: true; data: SearchQuery }
  | { success: false };

export function parseSearchQuery(
  input: URLSearchParams | SearchParams,
): SearchQueryResult {
  let q: string | undefined;

  if (input instanceof URLSearchParams) {
    const values = input.getAll("q");
    if (values.length > 1) return { success: false };
    q = values[0];
  } else {
    const value = input.q;
    if (Array.isArray(value)) return { success: false };
    q = value;
  }

  const result = schema.safeParse({ q });
  if (!result.success) return { success: false };
  return { success: true, data: result.data.q ? { q: result.data.q } : {} };
}
