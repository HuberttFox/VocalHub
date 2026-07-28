import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { safeReturnPath } from "@/lib/auth/return-path";

export type Viewer = { id: string; name: string | null };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, name: session.user.name ?? null };
});

export async function requireViewer(returnTo = "/favorites"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(safeReturnPath(returnTo))}`);
  }
  return viewer;
}

export async function requireViewerForMutation(): Promise<Viewer> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  return { id: session.user.id, name: session.user.name ?? null };
}
