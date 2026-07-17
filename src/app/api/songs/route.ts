import { NextResponse } from "next/server";
import { parseSongListQuery } from "@/lib/songs/list-query";
import { listSongs } from "@/lib/songs/repository";

export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const parsed = parseSongListQuery(new URL(request.url).searchParams);

  if (!parsed.success) {
    return errorResponse("INVALID_QUERY", "Invalid song list query", 400);
  }

  try {
    return NextResponse.json(await listSongs(parsed.data));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load songs", 500);
  }
}
