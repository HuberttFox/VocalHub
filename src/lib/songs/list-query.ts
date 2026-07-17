import { z } from "zod";

export const SONG_LIST_DEFAULT_PAGE_SIZE = 24;
export const SONG_LIST_MAX_PAGE_SIZE = 50;
export const SONG_LIST_MAX_PAGE = 10_000;
export const SONG_LIST_MAX_QUERY_LENGTH = 100;
export const SONG_LIST_SORTS = ["latest", "popular"] as const;

const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive());

const songListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(SONG_LIST_MAX_QUERY_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
  page: positiveIntegerString
    .pipe(z.number().max(SONG_LIST_MAX_PAGE))
    .optional()
    .default(1),
  pageSize: positiveIntegerString
    .pipe(z.number().max(SONG_LIST_MAX_PAGE_SIZE))
    .optional()
    .default(SONG_LIST_DEFAULT_PAGE_SIZE),
  sort: z.enum(SONG_LIST_SORTS).optional().default("latest"),
});

export type SongListQuery = z.output<typeof songListQuerySchema>;
export type SongListSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type SongListQueryResult =
  | { success: true; data: SongListQuery }
  | { success: false };

export function parseSongListQuery(
  input: URLSearchParams | SongListSearchParams,
): SongListQueryResult {
  const values = toKnownValues(input);

  if (!values) {
    return { success: false };
  }

  const result = songListQuerySchema.safeParse(values);
  if (!result.success) {
    return { success: false };
  }

  const { q, ...data } = result.data;
  return {
    success: true,
    data: q ? { ...data, q } : data,
  };
}

function toKnownValues(
  input: URLSearchParams | SongListSearchParams,
): Record<string, string | undefined> | null {
  const knownKeys = ["q", "page", "pageSize", "sort"] as const;
  const values: Record<string, string | undefined> = {};

  for (const key of knownKeys) {
    if (input instanceof URLSearchParams) {
      const entries = input.getAll(key);
      if (entries.length > 1) return null;
      values[key] = entries[0];
      continue;
    }

    const value = input[key];
    if (Array.isArray(value)) return null;
    values[key] = value;
  }

  return values;
}
