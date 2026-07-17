import { z } from "zod";

import { vocaDbSongSchema, type VocaDbSong } from "./contract";
import {
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

export type VocaDbClientOptions = {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class VocaDbClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: VocaDbClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? VOCADB_BASE_URL;
    this.userAgent = options.userAgent ?? VOCADB_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? VOCADB_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? VOCADB_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 250);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async getSong(songId: number): Promise<VocaDbSong> {
    if (!Number.isSafeInteger(songId) || songId <= 0) {
      throw new TypeError("VocaDB song ID must be a positive safe integer");
    }

    let lastError: VocaDbError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.requestSong(songId);
      } catch (error) {
        const classified = classifyRequestError(error, this.timeoutMs);
        lastError = classified;

        if (!classified.retryable || attempt === this.maxAttempts) {
          throw classified;
        }

        await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new VocaDbNetworkError();
  }

  private async requestSong(songId: number): Promise<VocaDbSong> {
    const url = new URL(`/api/songs/${songId}`, this.baseUrl);
    url.searchParams.set("fields", VOCADB_SONG_FIELDS);
    url.searchParams.set("lang", "Default");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw classifyRequestError(error, this.timeoutMs);
    }

    // Status is authoritative. In particular, VocaDB/proxies may return an
    // HTML 404 page, which must be classified as not-found before JSON parsing.
    if (response.status === 404) {
      throw new VocaDbNotFoundError(songId);
    }
    if (response.status === 429) {
      throw new VocaDbRateLimitError(response.status);
    }
    if (!response.ok) {
      throw new VocaDbHttpError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new VocaDbInvalidResponseError(
        "VocaDB returned malformed JSON",
        error,
      );
    }

    try {
      return vocaDbSongSchema.parse(payload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new VocaDbValidationError(
          "VocaDB song response failed validation",
          error.issues,
          error,
        );
      }
      throw error;
    }
  }
}

function classifyRequestError(error: unknown, timeoutMs: number): VocaDbError {
  if (error instanceof VocaDbError) return error;

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
