import { z } from "zod";
import { ENTITY_LIST_DEFAULT_PAGE_SIZE, ENTITY_LIST_MAX_PAGE, ENTITY_LIST_MAX_PAGE_SIZE } from "@/lib/catalog/entity-list-query";

const pageValue = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(ENTITY_LIST_MAX_PAGE));
const pageSizeValue = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(ENTITY_LIST_MAX_PAGE_SIZE));

export type DiscoveryQuery = { page: number; pageSize: number };
export type DiscoveryQueryResult = { success: true; data: DiscoveryQuery } | { success: false };

export function parseDiscoveryQuery(
  input: Record<string, string | string[] | undefined>,
): DiscoveryQueryResult {
  if (Array.isArray(input.page) || Array.isArray(input.pageSize)) return { success: false };
  const result = z.object({
    page: pageValue.optional().default(1),
    pageSize: pageSizeValue.optional().default(ENTITY_LIST_DEFAULT_PAGE_SIZE),
  }).safeParse({ page: input.page, pageSize: input.pageSize });
  return result.success ? { success: true, data: result.data } : { success: false };
}
