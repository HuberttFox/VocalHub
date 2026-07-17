import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/error-response";
import { getSongDetailById, isUuid } from "@/lib/songs/repository";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isUuid(id)) {
    return errorResponse("INVALID_SONG_ID", "Song ID must be a UUID", 400);
  }

  try {
    const song = await getSongDetailById(id);

    if (!song) {
      return errorResponse("SONG_NOT_FOUND", "Song not found", 404);
    }

    return NextResponse.json(song);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load song", 500);
  }
}
