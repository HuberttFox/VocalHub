import { timingSafeEqual } from "node:crypto";

export const OPERATIONAL_STATUS_TOKEN_PLACEHOLDER =
  "replace-with-a-random-operations-token";
export const MIN_OPERATIONAL_STATUS_TOKEN_LENGTH = 16;

export function getOperationalStatusToken(): string {
  const token = process.env.OPERATIONAL_STATUS_TOKEN;

  if (!token) {
    throw new Error("OPERATIONAL_STATUS_TOKEN is not configured");
  }
  if (token === OPERATIONAL_STATUS_TOKEN_PLACEHOLDER) {
    throw new Error(
      "OPERATIONAL_STATUS_TOKEN must not use the example placeholder value",
    );
  }
  if (token.length < MIN_OPERATIONAL_STATUS_TOKEN_LENGTH) {
    throw new Error(
      `OPERATIONAL_STATUS_TOKEN must be at least ${MIN_OPERATIONAL_STATUS_TOKEN_LENGTH} characters`,
    );
  }

  return token;
}

export function hasOperationalStatusAccess(request: Request) {
  const expectedToken = getOperationalStatusToken();
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = authorization.slice("Bearer ".length);
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
