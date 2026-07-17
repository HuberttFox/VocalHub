import { errorResponse } from "@/lib/http/error-response";
import { getArtistDetailById } from "@/lib/artists/repository";
import { isUuid } from "@/lib/catalog/id";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return errorResponse("INVALID_ARTIST_ID", "Artist ID must be a UUID", 400);
  }

  try {
    const artist = await getArtistDetailById(id);
    return artist
      ? NextResponse.json(artist)
      : errorResponse("ARTIST_NOT_FOUND", "Artist not found", 404);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load artist", 500);
  }
}
