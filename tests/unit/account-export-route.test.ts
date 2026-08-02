import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireViewer, getAccountExport } = vi.hoisted(() => ({
  requireViewer: vi.fn(),
  getAccountExport: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireViewer }));
vi.mock("@/lib/account/repository", () => ({ getAccountExport }));

import { GET } from "@/app/api/account/export/route";

describe("account export route", () => {
  beforeEach(() => {
    requireViewer.mockReset();
    getAccountExport.mockReset();
  });

  it("requires the authenticated viewer and returns a private download", async () => {
    requireViewer.mockResolvedValue({ id: "user-1" });
    getAccountExport.mockResolvedValue({ type: "vocalhub-account-export", version: 1 });

    const response = await GET();

    expect(requireViewer).toHaveBeenCalledWith("/api/account/export");
    expect(getAccountExport).toHaveBeenCalledWith("user-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("vocalhub-account-export.json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ type: "vocalhub-account-export", version: 1 });
  });

  it("does not query export data when authentication fails", async () => {
    const authenticationError = new Error("UNAUTHENTICATED");
    requireViewer.mockRejectedValue(authenticationError);

    await expect(GET()).rejects.toBe(authenticationError);
    expect(getAccountExport).not.toHaveBeenCalled();
  });
  it("returns not found when authenticated user disappears", async () => {
    requireViewer.mockResolvedValue({ id: "user-1" });
    getAccountExport.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" },
    });
  });

});
