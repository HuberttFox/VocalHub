import { z } from "zod";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/auth/account-policy";

export const accountDeletionSchema = z.object({
  confirmation: z.literal(ACCOUNT_DELETE_CONFIRMATION),
});
