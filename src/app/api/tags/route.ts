import { NextResponse } from "next/server";
import { parseEntityListQuery } from "@/lib/catalog/entity-list-query";
import { errorResponse } from "@/lib/http/error-response";
import { listTags } from "@/lib/tags/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const parsed = parseEntityListQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    return errorResponse("INVALID_QUERY", "Invalid tag list query", 400);
  }

  try {
    return NextResponse.json(await listTags(parsed.data));
  } catch (error) {
    console.error("Unable to load tags", error);
    return errorResponse("INTERNAL_ERROR", "Unable to load tags", 500);
  }
}
