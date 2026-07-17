import { describe, expect, it, vi } from "vitest";

import {
  VOCADB_SONG_FIELDS,
  VocaDbClient,
} from "@/lib/vocadb/client";
import {
  VocaDbHttpError,
  VocaDbNetworkError,
  VocaDbNotFoundError,
  VocaDbRateLimitError,
  VocaDbTimeoutError,
  VocaDbValidationError,
} from "@/lib/vocadb/errors";
import { makeVocaDbSongFixture } from "../fixtures/vocadb/song";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VocaDbClient", () => {
  it("requests the exact song fields and sends a User-Agent", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(makeVocaDbSongFixture()),
    );
    const client = new VocaDbClient({
      fetch: fetchMock,
      userAgent: "VocalHub-Test/1.0",
      sleep: vi.fn(),
    });

    await expect(client.getSong(123)).resolves.toMatchObject({ id: 123 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe(
      `https://vocadb.net/api/songs/123?fields=${encodeURIComponent(VOCADB_SONG_FIELDS)}&lang=Default`,
    );
    expect(new Headers(init?.headers).get("User-Agent")).toBe(
      "VocalHub-Test/1.0",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("classifies an HTML 404 by status before parsing the body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>not found</html>", { status: 404 }),
      );
    const client = new VocaDbClient({ fetch: fetchMock, sleep: vi.fn() });

    await expect(client.getSong(404)).rejects.toBeInstanceOf(
      VocaDbNotFoundError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, VocaDbRateLimitError, 3],
    [503, VocaDbHttpError, 3],
    [400, VocaDbHttpError, 1],
  ])("classifies HTTP %i and uses bounded retries", async (status, ErrorType, calls) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "failure" }, status));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new VocaDbClient({
      fetch: fetchMock,
      sleep,
      retryBaseDelayMs: 10,
    });

    await expect(client.getSong(123)).rejects.toBeInstanceOf(ErrorType);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(sleep).toHaveBeenCalledTimes(calls - 1);
    if (calls === 3) {
      expect(sleep).toHaveBeenNthCalledWith(1, 10);
      expect(sleep).toHaveBeenNthCalledWith(2, 20);
    }
  });

  it("retries network failures and succeeds within three attempts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockResolvedValueOnce(jsonResponse(makeVocaDbSongFixture()));
    const client = new VocaDbClient({ fetch: fetchMock, sleep: vi.fn() });

    await expect(client.getSong(123)).resolves.toMatchObject({ id: 123 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies exhausted network and timeout failures", async () => {
    const networkClient = new VocaDbClient({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
      sleep: vi.fn(),
    });
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    const timeoutClient = new VocaDbClient({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(timeout),
      sleep: vi.fn(),
      timeoutMs: 25,
    });

    await expect(networkClient.getSong(123)).rejects.toBeInstanceOf(
      VocaDbNetworkError,
    );
    await expect(timeoutClient.getSong(123)).rejects.toBeInstanceOf(
      VocaDbTimeoutError,
    );
  });

  it("classifies malformed JSON separately from invalid contracts", async () => {
    const malformedClient = new VocaDbClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("not-json", { status: 200 })),
      sleep: vi.fn(),
    });
    const invalid = makeVocaDbSongFixture() as Record<string, unknown>;
    delete invalid.artists;
    const invalidClient = new VocaDbClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(invalid)),
      sleep: vi.fn(),
    });

    await expect(malformedClient.getSong(123)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
    await expect(invalidClient.getSong(123)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("requires all requested relationship fields", async () => {
    for (const field of ["artists", "names", "pvs", "tags", "cultureCodes"]) {
      const payload = makeVocaDbSongFixture() as Record<string, unknown>;
      delete payload[field];
      const client = new VocaDbClient({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)),
        sleep: vi.fn(),
      });

      await expect(client.getSong(123)).rejects.toBeInstanceOf(
        VocaDbValidationError,
      );
    }
  });
});
