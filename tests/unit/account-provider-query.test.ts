import { describe, expect, it } from "vitest";
import { accountProviderSchema } from "@/lib/account/query";

describe("account provider query", () => {
  it("normalizes provider names", () => {
    expect(accountProviderSchema.parse({ provider: " GitHub " })).toEqual({ provider: "github" });
  });

  it("rejects unsafe or empty provider names", () => {
    expect(accountProviderSchema.safeParse({ provider: "" }).success).toBe(false);
    expect(accountProviderSchema.safeParse({ provider: "github/provider" }).success).toBe(false);
  });
});
