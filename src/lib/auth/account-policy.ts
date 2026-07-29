import type { TokenSet } from "@auth/core/types";

export const ACCOUNT_DELETE_CONFIRMATION = "删除我的账号";
export const SESSION_CLEANUP_GRACE_MS = 5 * 60 * 1_000;

export function stripOAuthTokens(tokens: TokenSet): TokenSet {
  void tokens;
  return {};
}

export function sessionCleanupCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_CLEANUP_GRACE_MS);
}
