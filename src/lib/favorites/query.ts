import { z } from "zod";
import { UUID_PATTERN } from "@/lib/catalog/id";

const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(50).default(24);

export type FavoriteListQuery = { page: number; pageSize: number };

export type FavoriteListQueryResult =
  | { success: true; data: FavoriteListQuery }
  | { success: false };

export function parseFavoriteListQuery(
  input: Record<string, string | string[] | undefined>,
): FavoriteListQueryResult {
  if (Array.isArray(input.page) || Array.isArray(input.pageSize)) {
    return { success: false };
  }
  const result = z.object({
    page: pageSchema,
    pageSize: pageSizeSchema,
  }).safeParse({ page: input.page, pageSize: input.pageSize });
  return result.success ? { success: true, data: result.data } : { success: false };
}

export const favoriteInputSchema = z.object({
  songId: z.string().regex(UUID_PATTERN),
  desired: z.enum(["true", "false"]).transform((value) => value === "true"),
});
