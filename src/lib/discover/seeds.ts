import { Prisma } from "@/generated/prisma/client";

export const DISCOVERY_SEED_LIMIT = 500;

export async function getDiscoverySeedIds(
  tx: Prisma.TransactionClient,
  viewerId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "songId" AS id FROM "Favorite" f
    JOIN "Song" s ON s.id = f."songId"
    WHERE f."userId" = ${viewerId}::uuid
      AND s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
    UNION
    SELECT ps."songId" AS id
    FROM "PlaylistSong" ps
    JOIN "Playlist" p ON p.id = ps."playlistId"
    JOIN "Song" s ON s.id = ps."songId"
    WHERE (p."userId" = ${viewerId}::uuid
       OR EXISTS (
         SELECT 1 FROM "PlaylistCollaborator" pc
         WHERE pc."playlistId" = p.id AND pc."userId" = ${viewerId}::uuid
       ))
      AND s."sourceDeleted" = false
      AND s."lastSyncedAt" IS NOT NULL
      AND s."syncStatus" IN ('SYNCED', 'FAILED')
    ORDER BY id ASC
    LIMIT ${DISCOVERY_SEED_LIMIT}
  `);
  return rows.map((row) => row.id);
}
