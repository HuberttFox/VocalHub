import { NextResponse } from "next/server";
import { isUuid } from "@/lib/catalog/id";
import { listArtistWorks } from "@/lib/artists/repository";
import { parseArtistWorksQuery } from "@/lib/artists/works-query";
import { errorResponse } from "@/lib/http/error-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return errorResponse("INVALID_ARTIST_ID", "Artist ID must be a UUID", 400);
  }

  const query = parseArtistWorksQuery(new URL(request.url).searchParams);
  if (!query.success) {
    return errorResponse("INVALID_QUERY", "Invalid artist works query", 400);
  }

  try {
    const works = await listArtistWorks(id, query.data);
    return works
      ? NextResponse.json(works)
      : errorResponse("ARTIST_NOT_FOUND", "Artist not found", 404);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load artist works", 500);
  }
}
