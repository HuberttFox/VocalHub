import { z } from "zod";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/auth/account-policy";

export const accountDeletionSchema = z.object({
  confirmation: z.literal(ACCOUNT_DELETE_CONFIRMATION),
});

export const accountProviderSchema = z.object({
  provider: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
});
