import { NextResponse } from "next/server";
import { parseEntityListQuery } from "@/lib/catalog/entity-list-query";
import { errorResponse } from "@/lib/http/error-response";
import { listArtists } from "@/lib/artists/list-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const parsed = parseEntityListQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    return errorResponse("INVALID_QUERY", "Invalid artist list query", 400);
  }

  try {
    return NextResponse.json(await listArtists(parsed.data));
  } catch (error) {
    console.error("Unable to load artists", error);
    return errorResponse("INTERNAL_ERROR", "Unable to load artists", 500);
  }
}
