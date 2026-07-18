import { describe, expect, it, vi } from "vitest";

import {
  VOCADB_ACTIVITY_MAX_RESULTS,
  VOCADB_SONG_FIELDS,
  VocaDbClient,
  parseRetryAfter,
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
      random: () => 0.5,
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

  it("discovers sorted, deduplicated song IDs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([42, 3, 42, 9]));
    const client = new VocaDbClient({ fetch: fetchMock, sleep: vi.fn() });

    await expect(client.getSongIds()).resolves.toEqual([3, 9, 42]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://vocadb.net/api/songs/ids",
    );
  });

  it.each([
    { payload: [] },
    { payload: [0] },
    { payload: [-1] },
    { payload: [1.5] },
    { payload: [Number.MAX_SAFE_INTEGER + 1] },
  ])(
    "rejects an invalid song ID discovery contract: $payload",
    async ({ payload }) => {
      const client = new VocaDbClient({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)),
        sleep: vi.fn(),
      });

      await expect(client.getSongIds()).rejects.toBeInstanceOf(
        VocaDbValidationError,
      );
    },
  );

  it("requests and parses song activity entries", async () => {
    const payload = {
      items: [
        {
          createDate: "2026-07-17T12:00:00Z",
          editEvent: "Updated",
          entry: { id: 17, entryType: "Song", name: "Song" },
        },
        {
          createDate: "2026-07-17T13:00:00Z",
          editEvent: "Updated",
          entry: { id: 2, entryType: "Artist" },
        },
        { unrelated: true },
      ],
      totalCount: 3,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload));
    const client = new VocaDbClient({ fetch: fetchMock, sleep: vi.fn() });

    await expect(
      client.getSongActivityEntries({
        since: "2026-07-16T00:00:00Z",
        before: new Date("2026-07-18T00:00:00Z"),
      }),
    ).resolves.toEqual([
      {
        createDate: "2026-07-17T12:00:00Z",
        editEvent: "Updated",
        entry: { id: 17 },
      },
    ]);

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/api/activityEntries");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      since: "2026-07-16T00:00:00.000Z",
      before: "2026-07-18T00:00:00.000Z",
      entryType: "Song",
      fields: "Entry",
      sortRule: "CreateDate",
      maxResults: String(VOCADB_ACTIVITY_MAX_RESULTS),
    });
  });

  it.each([
    {
      createDate: "invalid",
      editEvent: "Updated",
      entry: { id: 17, entryType: "Song" },
    },
    {
      createDate: "2026-07-17T12:00:00Z",
      entry: { id: 17, entryType: "Song" },
    },
    {
      createDate: "2026-07-17T12:00:00Z",
      editEvent: "Updated",
      entry: { id: 0, entryType: "Song" },
    },
  ])("rejects a malformed song activity candidate", async (candidate) => {
    const client = new VocaDbClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ items: [candidate] })),
      sleep: vi.fn(),
    });

    await expect(client.getSongActivityEntries()).rejects.toBeInstanceOf(
      VocaDbValidationError,
    );
  });

  it("parses Retry-After delta seconds and HTTP dates", () => {
    const now = Date.parse("2026-07-17T12:00:00Z");
    expect(parseRetryAfter("12", now)).toBe(12_000);
    expect(parseRetryAfter("Fri, 17 Jul 2026 12:00:09 GMT", now)).toBe(9_000);
    expect(parseRetryAfter("invalid", now)).toBeUndefined();
  });

  it("shares Retry-After cooldown across client instances", async () => {
    let now = Date.parse("2026-07-17T12:00:00Z");
    const firstSleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const firstClient = new VocaDbClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "10" },
          }),
        )
        .mockResolvedValueOnce(jsonResponse([1])),
      maxAttempts: 2,
      retryBaseDelayMs: 1,
      now: () => now,
      random: () => 0.5,
      sleep: firstSleep,
    });

    await expect(firstClient.getSongIds()).resolves.toEqual([1]);
    expect(firstSleep).toHaveBeenCalledWith(10_000);

    now -= 5_000;
    const secondSleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const secondFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([2]));
    const secondClient = new VocaDbClient({
      fetch: secondFetch,
      now: () => now,
      sleep: secondSleep,
    });

    await expect(secondClient.getSongIds()).resolves.toEqual([2]);
    expect(secondSleep).toHaveBeenCalledWith(5_000);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds retry jitter around exponential backoff", async () => {
    for (const [random, expected] of [
      [0, 75],
      [1, 125],
    ] as const) {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const client = new VocaDbClient({
        fetch: vi
          .fn<typeof fetch>()
          .mockRejectedValueOnce(new TypeError("offline"))
          .mockResolvedValueOnce(jsonResponse([1])),
        maxAttempts: 2,
        retryBaseDelayMs: 100,
        random: () => random,
        sleep,
      });

      await client.getSongIds();
      expect(sleep).toHaveBeenCalledWith(expected);
    }
  });
});
