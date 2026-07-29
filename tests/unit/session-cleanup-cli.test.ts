import { describe, expect, it } from "vitest";
import { assertNoCleanupArguments } from "../../maintenance/cleanup-auth-sessions";

describe("session cleanup CLI", () => {
  it("accepts no arguments and rejects every option", () => {
    expect(() => assertNoCleanupArguments([])).not.toThrow();
    expect(() => assertNoCleanupArguments(["--before=now"])).toThrow(
      "Session cleanup does not accept arguments",
    );
  });
});
