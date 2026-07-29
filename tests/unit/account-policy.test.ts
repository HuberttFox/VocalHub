import { describe, expect, it } from "vitest";
import type { TokenSet } from "@auth/core/types";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  SESSION_CLEANUP_GRACE_MS,
  sessionCleanupCutoff,
  stripOAuthTokens,
} from "@/lib/auth/account-policy";
import { accountDeletionSchema } from "@/lib/account/query";

describe("account lifecycle policy", () => {
  it("requires the exact account deletion phrase", () => {
    expect(accountDeletionSchema.parse({ confirmation: ACCOUNT_DELETE_CONFIRMATION })).toEqual({
      confirmation: ACCOUNT_DELETE_CONFIRMATION,
    });
    for (const confirmation of ["", ` ${ACCOUNT_DELETE_CONFIRMATION}`, `${ACCOUNT_DELETE_CONFIRMATION} `, "删除账号"]) {
      expect(() => accountDeletionSchema.parse({ confirmation })).toThrow();
    }
  });

  it("does not persist OAuth token fields", () => {
    const tokens: TokenSet = {
      access_token: "access",
      refresh_token: "refresh",
      id_token: "identity",
      expires_at: 123,
      scope: "read:user",
      token_type: "bearer",
    };
    expect(stripOAuthTokens(tokens)).toEqual({});
  });

  it("calculates the physical cleanup cutoff with grace", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    expect(sessionCleanupCutoff(now).getTime()).toBe(now.getTime() - SESSION_CLEANUP_GRACE_MS);
  });
});
