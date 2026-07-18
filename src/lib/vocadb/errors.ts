import type { ZodError } from "zod";

export type VocaDbErrorCode =
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CLIENT_ERROR"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_JSON"
  | "VALIDATION_ERROR";

type VocaDbErrorOptions = {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
};

export class VocaDbError extends Error {
  readonly code: VocaDbErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: VocaDbErrorCode,
    message: string,
    options: VocaDbErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export class VocaDbNotFoundError extends VocaDbError {
  constructor(songId: number) {
    super("NOT_FOUND", `VocaDB song ${songId} was not found`, { status: 404 });
  }
}

export class VocaDbRateLimitError extends VocaDbError {
  readonly retryAfterMs: number | undefined;

  constructor(status = 429, retryAfterMs?: number) {
    super("RATE_LIMITED", "VocaDB rate limit was exceeded", {
      status,
      retryable: true,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class VocaDbHttpError extends VocaDbError {
  constructor(status: number) {
    const retryable = status === 408 || status === 425 || status >= 500;
    super(
      status >= 500 ? "SERVER_ERROR" : "CLIENT_ERROR",
      `VocaDB returned HTTP ${status}`,
      {
        status,
        retryable,
      },
    );
  }
}

export class VocaDbTimeoutError extends VocaDbError {
  constructor(timeoutMs: number, cause?: unknown) {
    super("TIMEOUT", `VocaDB request timed out after ${timeoutMs}ms`, {
      retryable: true,
      cause,
    });
  }
}

export class VocaDbNetworkError extends VocaDbError {
  constructor(cause?: unknown) {
    super("NETWORK_ERROR", "VocaDB request failed", {
      retryable: true,
      cause,
    });
  }
}

export class VocaDbValidationError extends VocaDbError {
  readonly issues: ZodError["issues"];

  constructor(message: string, issues: ZodError["issues"], cause?: unknown) {
    super("VALIDATION_ERROR", message, { cause });
    this.issues = issues;
  }
}

export class VocaDbInvalidResponseError extends VocaDbError {
  constructor(message: string, cause?: unknown) {
    super("INVALID_JSON", message, { cause });
  }
}

export type VocaDBErrorCode = VocaDbErrorCode;
export { VocaDbError as VocaDBError };
