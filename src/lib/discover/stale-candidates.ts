import { Prisma } from "@/generated/prisma/client";

export const DISCOVERY_CATALOG_STATE_ID = "catalog";

export function staleDiscoveryCandidatesQuery(expiredLeaseAt: Date): Prisma.Sql {
  return Prisma.sql`
    WITH profile_users AS (
      SELECT "userId" AS id FROM "DiscoveryProfile"
      UNION
      SELECT f."userId" AS id FROM "Favorite" f
      UNION
      SELECT p."userId" AS id FROM "Playlist" p
      JOIN "PlaylistSong" ps ON ps."playlistId" = p.id
      UNION
      SELECT pc."userId" AS id FROM "PlaylistCollaborator" pc
      JOIN "PlaylistSong" ps ON ps."playlistId" = pc."playlistId"
    ), stale_candidates AS (
      SELECT users.id AS "userId", profile."updatedAt" AS "profileUpdatedAt"
      FROM profile_users users
      LEFT JOIN "DiscoveryProfile" profile ON profile."userId" = users.id
      LEFT JOIN "DiscoverySnapshot" snapshot ON snapshot.id = profile."currentSnapshotId"
      LEFT JOIN "DiscoveryCatalogState" catalog ON catalog.id = ${DISCOVERY_CATALOG_STATE_ID}
      WHERE (
        snapshot.id IS NULL
        OR snapshot.status <> 'READY'
        OR snapshot."libraryVersion" <> profile."libraryVersion"
        OR snapshot."catalogVersion" < GREATEST(
          profile."requiredCatalogVersion",
          COALESCE(catalog.version, 0)
        )
      )
        AND (
          profile."refreshStartedAt" IS NULL
          OR profile."refreshStartedAt" < ${expiredLeaseAt}
        )
    )
  `;
}
