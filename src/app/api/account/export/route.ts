import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth/session";
import { getAccountExport } from "@/lib/account/repository";

export const runtime = "nodejs";

export async function GET() {
  const viewer = await requireViewer("/api/account/export");
  const data = await getAccountExport(viewer.id);
  if (!data) {
    return NextResponse.json(
      { error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" } },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return new NextResponse(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="vocalhub-account-export.json"',
      "Cache-Control": "private, no-store",
    },
  });
}
