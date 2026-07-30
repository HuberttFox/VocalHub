import { NextResponse } from "next/server";
import { isUuid } from "@/lib/catalog/id";
import { errorResponse } from "@/lib/http/error-response";
import { getTagDetailById } from "@/lib/tags/repository";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return errorResponse("INVALID_TAG_ID", "Tag ID must be a UUID", 400);
  }

  try {
    const tag = await getTagDetailById(id);
    return tag
      ? NextResponse.json(tag)
      : errorResponse("TAG_NOT_FOUND", "Tag not found", 404);
  } catch (error) {
    console.error("Unable to load tag", error);
    return errorResponse("INTERNAL_ERROR", "Unable to load tag", 500);
  }
}
