"use server";

import { signOut } from "@/auth";
import { requireViewerForMutation } from "@/lib/auth/session";
import { accountDeletionSchema } from "@/lib/account/query";
import { deleteUserAccount, revokeUserSessions } from "@/lib/account/repository";

export async function revokeAllSessionsAction(): Promise<void> {
  const viewer = await requireViewerForMutation();
  await revokeUserSessions(viewer.id);
  await signOut({ redirectTo: "/" });
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  accountDeletionSchema.parse({ confirmation: formData.get("confirmation") });
  await deleteUserAccount(viewer.id);
  await signOut({ redirectTo: "/" });
}
