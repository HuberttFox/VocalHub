-- Purge OAuth credentials that VocalHub does not use after sign-in.
UPDATE "Account"
SET
  "refresh_token" = NULL,
  "access_token" = NULL,
  "expires_at" = NULL,
  "token_type" = NULL,
  "scope" = NULL,
  "id_token" = NULL,
  "session_state" = NULL
WHERE
  "refresh_token" IS NOT NULL
  OR "access_token" IS NOT NULL
  OR "expires_at" IS NOT NULL
  OR "token_type" IS NOT NULL
  OR "scope" IS NOT NULL
  OR "id_token" IS NOT NULL
  OR "session_state" IS NOT NULL;
