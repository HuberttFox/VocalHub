import { NextResponse } from "next/server";
import { hasOperationalStatusAccess } from "@/lib/operations/auth";
import { getOperationsStatus } from "@/lib/operations/status-repository";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    if (!hasOperationalStatusAccess(request)) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
        { status: 401, headers },
      );
    }

    const status = await getOperationsStatus();
    return NextResponse.json(status, {
      status: status.classification === "READY" ? 200 : 503,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "UNAVAILABLE", message: "Operations status unavailable" } },
      { status: 503, headers },
    );
  }
}
