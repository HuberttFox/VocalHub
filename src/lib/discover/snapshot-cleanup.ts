import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";

export const DISCOVERY_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type DiscoverySnapshotCleanupDb = Pick<PrismaClient, "$queryRaw">;

export async function databaseDiscoverySnapshotCleanupCutoff(
  db: DiscoverySnapshotCleanupDb,
): Promise<Date> {
  const retentionSeconds = DISCOVERY_SNAPSHOT_RETENTION_MS / 1_000;
  const rows = await db.$queryRaw<Array<{ cutoff: Date }>>(Prisma.sql`
    SELECT CURRENT_TIMESTAMP - (${retentionSeconds} * INTERVAL '1 second') AS cutoff
  `);
  const cutoff = rows[0]?.cutoff;
  if (!cutoff) throw new Error("PostgreSQL did not return a discovery snapshot cleanup cutoff");
  return cutoff;
}

export async function deleteExpiredDiscoverySnapshots(
  db: DiscoverySnapshotCleanupDb,
  cutoff: Date,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Discovery snapshot cleanup limit must be a positive safe integer");
  }
  const deleted = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS (
      SELECT snapshot.id
      FROM "DiscoverySnapshot" AS snapshot
      WHERE snapshot.status IN ('READY', 'FAILED')
        AND snapshot."finishedAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1
          FROM "DiscoveryProfile" AS profile
          WHERE profile."currentSnapshotId" = snapshot.id
        )
      ORDER BY snapshot."finishedAt" ASC, snapshot.id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "DiscoverySnapshot" AS snapshot
    USING candidates
    WHERE snapshot.id = candidates.id
      AND NOT EXISTS (
        SELECT 1
        FROM "DiscoveryProfile" AS profile
        WHERE profile."currentSnapshotId" = snapshot.id
      )
    RETURNING snapshot.id
  `);
  return deleted.length;
}
