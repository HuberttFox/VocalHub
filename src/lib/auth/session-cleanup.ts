import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { SESSION_CLEANUP_GRACE_MS } from "@/lib/auth/account-policy";

export type SessionCleanupDb = Pick<PrismaClient, "$queryRaw" | "session">;

export async function databaseSessionCleanupCutoff(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<Date> {
  const graceSeconds = SESSION_CLEANUP_GRACE_MS / 1_000;
  const rows = await db.$queryRaw<Array<{ cutoff: Date }>>(Prisma.sql`
    SELECT CURRENT_TIMESTAMP - (${graceSeconds} * INTERVAL '1 second') AS cutoff
  `);
  const cutoff = rows[0]?.cutoff;
  if (!cutoff) throw new Error("PostgreSQL did not return a session cleanup cutoff");
  return cutoff;
}

export async function deleteExpiredSessions(
  db: SessionCleanupDb,
  cutoff: Date,
): Promise<number> {
  return (await db.session.deleteMany({ where: { expires: { lt: cutoff } } })).count;
}
