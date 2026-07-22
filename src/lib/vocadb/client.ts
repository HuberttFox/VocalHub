import { z } from "zod";

import {
  vocaDbActivityEntriesResponseSchema,
  vocaDbSongIdsSchema,
  vocaDbSongSchema,
  type VocaDbActivityEntry,
  type VocaDbSong,
} from "./contract";
import {
  throwIfVocaDbCancelled,
  VocaDbCancellationError,
  VocaDbError,
  VocaDbHttpError,
  VocaDbInvalidResponseError,
  VocaDbNetworkError,
  VocaDbNotFoundError,
  VocaDbRateLimitError,
  VocaDbTimeoutError,
  VocaDbValidationError,
} from "./errors";

export const VOCADB_BASE_URL = "https://vocadb.net";
export const VOCADB_SONG_FIELDS =
  "Artists,Names,PVs,Tags,MainPicture,CultureCodes";
export const VOCADB_USER_AGENT = "VocalHub/0.1 (VocaDB client)";
export const VOCADB_TIMEOUT_MS = 10_000;
export const VOCADB_MAX_ATTEMPTS = 3;
export const VOCADB_ACTIVITY_MAX_RESULTS = 500;

const RETRY_JITTER_RATIO = 0.25;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
let processCooldownUntil = 0;

export type VocaDbClientOptions = {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export type VocaDbSongActivityOptions = {
  since?: Date | string;
  before?: Date | string;
  signal?: AbortSignal;
};

export type VocaDbRequestOptions = {
  signal?: AbortSignal;
};

type RequestOptions<T> = {
  schema: z.ZodType<T>;
  validationMessage: string;
  notFoundSongId?: number;
};

export class VocaDbClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: VocaDbClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? VOCADB_BASE_URL;
    this.userAgent = options.userAgent ?? VOCADB_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? VOCADB_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? VOCADB_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 250);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async getSong(
    songId: number,
    request: VocaDbRequestOptions = {},
  ): Promise<VocaDbSong> {
    assertPositiveSafeInteger(songId, "VocaDB song ID");

    const url = new URL(`/api/songs/${songId}`, this.baseUrl);
    url.searchParams.set("fields", VOCADB_SONG_FIELDS);
    url.searchParams.set("lang", "Default");

    return this.requestWithRetry(
      url,
      {
        schema: vocaDbSongSchema,
        validationMessage: "VocaDB song response failed validation",
        notFoundSongId: songId,
      },
      request.signal,
    );
  }

  async getSongIds(
    request: VocaDbRequestOptions = {},
  ): Promise<number[]> {
    const url = new URL("/api/songs/ids", this.baseUrl);
    return this.requestWithRetry(
      url,
      {
        schema: vocaDbSongIdsSchema,
        validationMessage: "VocaDB song ID response failed validation",
      },
      request.signal,
    );
  }

  async getSongActivityEntries(
    options: VocaDbSongActivityOptions = {},
  ): Promise<VocaDbActivityEntry[]> {
    const url = new URL("/api/activityEntries", this.baseUrl);
    setDateParameter(url, "since", options.since);
    setDateParameter(url, "before", options.before);
    url.searchParams.set("entryType", "Song");
    url.searchParams.set("fields", "Entry");
    url.searchParams.set("sortRule", "CreateDate");
    url.searchParams.set("maxResults", String(VOCADB_ACTIVITY_MAX_RESULTS));

    return this.requestWithRetry(
      url,
      {
        schema: vocaDbActivityEntriesResponseSchema,
        validationMessage: "VocaDB activity response failed validation",
      },
      options.signal,
    );
  }

  private async requestWithRetry<T>(
    url: URL,
    options: RequestOptions<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: VocaDbError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      throwIfVocaDbCancelled(signal);
      await this.waitForCooldown(signal);
      throwIfVocaDbCancelled(signal);

      try {
        return await this.request(url, options, signal);
      } catch (error) {
        const classified = classifyRequestError(error, this.timeoutMs, signal);
        lastError = classified;

        if (!classified.retryable || attempt === this.maxAttempts) {
          throw classified;
        }

        const backoff = this.retryDelay(attempt);
        const cooldown = Math.max(0, processCooldownUntil - this.now());
        await this.wait(Math.max(backoff, cooldown), signal);
      }
    }

    throw lastError ?? new VocaDbNetworkError();
  }

  private async request<T>(
    url: URL,
    options: RequestOptions<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: requestSignal,
      });
    } catch (error) {
      throw classifyRequestError(error, this.timeoutMs, signal, timeoutSignal);
    }

    // Status is authoritative. In particular, VocaDB/proxies may return an
    // HTML 404 page, which must be classified before JSON parsing.
    if (response.status === 404 && options.notFoundSongId !== undefined) {
      throw new VocaDbNotFoundError(options.notFoundSongId);
    }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(
        response.headers.get("Retry-After"),
        this.now(),
      );
      if (retryAfterMs !== undefined) {
        processCooldownUntil = Math.max(
          processCooldownUntil,
          this.now() + retryAfterMs,
        );
      }
      throw new VocaDbRateLimitError(response.status, retryAfterMs);
    }
    if (!response.ok) {
      throw new VocaDbHttpError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
      throwIfVocaDbCancelled(signal);
    } catch (error) {
      if (signal?.aborted) throw new VocaDbCancellationError(signal.reason);
      if (timeoutSignal.aborted) {
        throw new VocaDbTimeoutError(this.timeoutMs, error);
      }
      throw new VocaDbInvalidResponseError(
        "VocaDB returned malformed JSON",
        error,
      );
    }

    try {
      return options.schema.parse(payload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new VocaDbValidationError(
          options.validationMessage,
          error.issues,
          error,
        );
      }
      throw error;
    }
  }

  private async waitForCooldown(signal?: AbortSignal): Promise<void> {
    while (processCooldownUntil > this.now()) {
      const remaining = Math.min(
        processCooldownUntil - this.now(),
        MAX_TIMER_DELAY_MS,
      );
      await this.wait(remaining, signal);
    }
  }

  private async wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    throwIfVocaDbCancelled(signal);
    if (!signal) {
      await this.sleep(milliseconds);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        reject(new VocaDbCancellationError(signal.reason));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.sleep(milliseconds).then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private retryDelay(attempt: number): number {
    const exponential = this.retryBaseDelayMs * 2 ** (attempt - 1);
    const random = Math.min(1, Math.max(0, this.random()));
    const jitterMultiplier =
      1 - RETRY_JITTER_RATIO + random * RETRY_JITTER_RATIO * 2;
    return Math.round(exponential * jitterMultiplier);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function setDateParameter(
  url: URL,
  name: "since" | "before",
  value: Date | string | undefined,
): void {
  if (value === undefined) return;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`VocaDB activity ${name} must be a valid date`);
  }
  url.searchParams.set(name, date.toISOString());
}

export function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (value === null) return undefined;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds)
      ? Math.min(seconds * 1_000, MAX_TIMER_DELAY_MS)
      : undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.min(Math.max(0, timestamp - now), MAX_TIMER_DELAY_MS);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function classifyRequestError(
  error: unknown,
  timeoutMs: number,
  callerSignal?: AbortSignal,
  timeoutSignal?: AbortSignal,
): VocaDbError {
  if (error instanceof VocaDbError) return error;
  if (callerSignal?.aborted) {
    return new VocaDbCancellationError(callerSignal.reason ?? error);
  }
  if (timeoutSignal?.aborted) {
    return new VocaDbTimeoutError(timeoutMs, error);
  }

  if (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return new VocaDbTimeoutError(timeoutMs, error);
  }

  return new VocaDbNetworkError(error);
}

export const vocaDbClient = new VocaDbClient();
export const vocaDBClient = vocaDbClient;
export { VocaDbClient as VocaDBClient };

export function getVocaDbSong(songId: number): Promise<VocaDbSong> {
  return vocaDbClient.getSong(songId);
}

export const getVocaDBSong = getVocaDbSong;
