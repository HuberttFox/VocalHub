"use server";

import { signOut } from "@/auth";
import { requireViewerForMutation } from "@/lib/auth/session";
import { accountDeletionSchema, accountProviderSchema } from "@/lib/account/query";
import {
  deleteUserAccount,
  disconnectAccountProvider,
  revokeUserSessions,
} from "@/lib/account/repository";

export type DisconnectProviderState = { error: string | null };

export async function disconnectProviderAction(
  _previousState: DisconnectProviderState,
  formData: FormData,
): Promise<DisconnectProviderState> {
  try {
    const viewer = await requireViewerForMutation();
    const parsed = accountProviderSchema.safeParse({ provider: formData.get("provider") });
    if (!parsed.success) return { error: "登录来源参数无效。" };
    const result = await disconnectAccountProvider(viewer.id, parsed.data.provider);
    if (result === "LAST_PROVIDER") return { error: "最后一个登录来源不可断开，请使用永久删除账号流程。" };
    if (result === "NOT_FOUND") return { error: "登录来源未连接或账号已不存在。" };
    await signOut({ redirectTo: "/" });
    return { error: null };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return { error: "登录状态已失效，请重新登录。" };
    }
    throw error;
  }
}

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
