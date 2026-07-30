import { NextResponse } from "next/server";
import { parseArtistWorksQuery } from "@/lib/artists/works-query";
import { isUuid } from "@/lib/catalog/id";
import { errorResponse } from "@/lib/http/error-response";
import { listTagSongs } from "@/lib/tags/repository";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return errorResponse("INVALID_TAG_ID", "Tag ID must be a UUID", 400);
  }

  const query = parseArtistWorksQuery(new URL(request.url).searchParams);
  if (!query.success) {
    return errorResponse("INVALID_QUERY", "Invalid tag songs query", 400);
  }

  try {
    const songs = await listTagSongs(id, query.data);
    return songs
      ? NextResponse.json(songs)
      : errorResponse("TAG_NOT_FOUND", "Tag not found", 404);
  } catch (error) {
    console.error("Unable to load tag songs", error);
    return errorResponse("INTERNAL_ERROR", "Unable to load tag songs", 500);
  }
}
