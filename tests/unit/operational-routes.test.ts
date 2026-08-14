import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, getOperationsStatus } = vi.hoisted(() => ({
  getDb: vi.fn(),
  getOperationsStatus: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/operations/status-repository", () => ({ getOperationsStatus }));

import { GET as getHealth } from "@/app/api/health/route";
import { GET as getOperationsStatusRoute } from "@/app/api/ops/status/route";

const originalToken = process.env.OPERATIONAL_STATUS_TOKEN;

const VALID_TOKEN = "test-operations-token-1234";

function operationsRequest(authorization?: string) {
  return new Request("http://localhost/api/ops/status", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("operational API routes", () => {
  beforeEach(() => {
    getDb.mockReset();
    getOperationsStatus.mockReset();
    process.env.OPERATIONAL_STATUS_TOKEN = VALID_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.OPERATIONAL_STATUS_TOKEN;
    } else {
      process.env.OPERATIONAL_STATUS_TOKEN = originalToken;
    }
  });

  it("reports health only after the database readiness query succeeds", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    getDb.mockReturnValue({ $queryRaw: queryRaw });

    const response = await getHealth();

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports unavailable health when the database readiness query fails", async () => {
    getDb.mockReturnValue({ $queryRaw: vi.fn().mockRejectedValue(new Error("offline")) });

    const response = await getHealth();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("rejects every invalid bearer credential before calling the status repository", async () => {
    for (const authorization of [undefined, "Basic test-token", "Bearer wrong-token"]) {
      const response = await getOperationsStatusRoute(operationsRequest(authorization));

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
    }
    expect(getOperationsStatus).not.toHaveBeenCalled();
  });

  it("returns the protected ready operations status for a valid bearer credential", async () => {
    getOperationsStatus.mockResolvedValue({ classification: "READY" });

    const response = await getOperationsStatusRoute(operationsRequest(`Bearer ${VALID_TOKEN}`));

    expect(getOperationsStatus).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ classification: "READY" });
  });

  it("forwards discovery status unchanged for a valid bearer credential", async () => {
    const discovery = {
      staleProfileCount: 2,
      failedProfileCount: 1,
      oldestPendingAt: "2026-08-09T12:00:00.000Z",
    };
    getOperationsStatus.mockResolvedValue({ classification: "READY", discovery });

    const response = await getOperationsStatusRoute(operationsRequest(`Bearer ${VALID_TOKEN}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ classification: "READY", discovery });
  });

  it("returns unavailable status for a non-ready operations result", async () => {
    getOperationsStatus.mockResolvedValue({ classification: "STALE" });

    const response = await getOperationsStatusRoute(operationsRequest(`Bearer ${VALID_TOKEN}`));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ classification: "STALE" });
  });

  it("returns unavailable when the protected status repository fails", async () => {
    getOperationsStatus.mockRejectedValue(new Error("offline"));

    const response = await getOperationsStatusRoute(operationsRequest(`Bearer ${VALID_TOKEN}`));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { code: "UNAVAILABLE", message: "Operations status unavailable" },
    });
  });

  it("fails closed instead of serving status when the token is the example placeholder", async () => {
    process.env.OPERATIONAL_STATUS_TOKEN =
      "replace-with-a-random-operations-token";
    getOperationsStatus.mockResolvedValue({ classification: "READY" });

    const response = await getOperationsStatusRoute(
      operationsRequest("Bearer replace-with-a-random-operations-token"),
    );

    expect(response.status).toBe(503);
    expect(getOperationsStatus).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: { code: "UNAVAILABLE", message: "Operations status unavailable" },
    });
  });

  it("fails closed when the configured token is too short", async () => {
    process.env.OPERATIONAL_STATUS_TOKEN = "short";
    getOperationsStatus.mockResolvedValue({ classification: "READY" });

    const response = await getOperationsStatusRoute(
      operationsRequest("Bearer short"),
    );

    expect(response.status).toBe(503);
    expect(getOperationsStatus).not.toHaveBeenCalled();
  });
});
