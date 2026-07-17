import { z } from "zod";
import {
  SONG_LIST_DEFAULT_PAGE_SIZE,
  SONG_LIST_MAX_PAGE,
  SONG_LIST_MAX_PAGE_SIZE,
  SONG_LIST_SORTS,
  type SongListSearchParams,
} from "@/lib/songs/list-query";

const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive());

const artistWorksQuerySchema = z.object({
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

export type ArtistWorksQuery = z.output<typeof artistWorksQuerySchema>;
export type ArtistWorksSearchParams = SongListSearchParams;

export type ArtistWorksQueryResult =
  | { success: true; data: ArtistWorksQuery }
  | { success: false };

export function parseArtistWorksQuery(
  input: URLSearchParams | ArtistWorksSearchParams,
): ArtistWorksQueryResult {
  const values: Record<string, string | undefined> = {};

  for (const key of ["page", "pageSize", "sort"] as const) {
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

  const result = artistWorksQuerySchema.safeParse(values);
  return result.success
    ? { success: true, data: result.data }
    : { success: false };
}
