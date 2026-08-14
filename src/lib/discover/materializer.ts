import { Prisma } from "@/generated/prisma/client";
import { DiscoverySnapshotStatus } from "@/generated/prisma/enums";
import { PUBLIC_SONG_WHERE } from "@/lib/catalog/visibility";
import { getDb } from "@/lib/db";
import {
  getDiscoveryMaterializerTiming,
  SHORT_TRANSACTION_TIMEOUT_MS,
  type DiscoveryMaterializerBatchTiming,
  type DiscoveryMaterializerTiming,
} from "@/lib/discover/materializer-timing";
import type { DiscoveryQuery } from "@/lib/discover/query";
import { getDiscoverySeedIds } from "@/lib/discover/seeds";
import {
  DISCOVERY_CATALOG_STATE_ID,
  staleDiscoveryCandidatesQuery,
} from "@/lib/discover/stale-candidates";

export { DISCOVERY_CATALOG_STATE_ID } from "@/lib/discover/stale-candidates";

const SHORT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: SHORT_TRANSACTION_TIMEOUT_MS,
} as const;

type DiscoveryTransaction = Prisma.TransactionClient;
type DiscoveryDatabase = Pick<ReturnType<typeof getDb>, "$transaction">;
type DiscoveryBuild = {
  snapshotId: string;
  libraryVersion: number;
  catalogVersion: number;
  refreshStartedAt: Date;
};

export type DiscoverySnapshotRead = {
  rows: Array<{ id: string }>;
  totalCount: number;
  freshness: "FRESH" | "STALE";
};

export type DiscoveryMaterializerStopReason =
  | "NO_STALE_PROFILES"
  | "QUEUE_DRAINED"
  | "LIMIT_REACHED"
  | "BUDGET_EXHAUSTED";

export type DiscoveryMaterializerResult = {
  selectedCount: number;
  attemptedCount: number;
  publishedCount: number;
  failedCount: number;
  deferredCount: number;
  stopReason: DiscoveryMaterializerStopReason;
  batchBudgetMs: number | null;
  attemptReservationMs: number | null;
};

type DiscoveryMaterializerProfileTiming = DiscoveryMaterializerTiming;

export type DiscoveryMaterializerOptions = {
  batchTiming?: DiscoveryMaterializerBatchTiming;
  now?: () => number;
};

export async function invalidateDiscoveryProfiles(
  tx: DiscoveryTransaction,
  userIds: Iterable<string>,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await invalidateDiscoveryProfile(tx, userId);
  }
}

export async function invalidateDiscoveryProfile(
  tx: DiscoveryTransaction,
  userId: string,
): Promise<void> {
  const catalogVersion = await getCatalogVersion(tx);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "DiscoveryProfile" (
      "userId", "libraryVersion", "requiredCatalogVersion", "createdAt", "updatedAt"
    ) VALUES (
      ${userId}::uuid, 1, ${catalogVersion}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId") DO UPDATE
    SET "libraryVersion" = "DiscoveryProfile"."libraryVersion" + 1,
        "requiredCatalogVersion" = GREATEST(
          "DiscoveryProfile"."requiredCatalogVersion",
          EXCLUDED."requiredCatalogVersion"
        ),
        "lastRefreshError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
  `);
}

export async function invalidateDiscoveryCatalog(
  tx: DiscoveryTransaction,
): Promise<number> {
  const state = await tx.discoveryCatalogState.upsert({
    where: { id: DISCOVERY_CATALOG_STATE_ID },
    create: { id: DISCOVERY_CATALOG_STATE_ID, version: 1 },
    update: { version: { increment: 1 } },
    select: { version: true },
  });
  return state.version;
}

export async function getSnapshotDiscovery(
  tx: DiscoveryTransaction,
  userId: string,
  query: DiscoveryQuery,
): Promise<DiscoverySnapshotRead | null> {
  const [profile, catalogVersion] = await Promise.all([
    tx.discoveryProfile.findUnique({
      where: { userId },
      select: {
        libraryVersion: true,
        requiredCatalogVersion: true,
        currentSnapshot: {
          select: {
            id: true,
            status: true,
            libraryVersion: true,
            catalogVersion: true,
            totalItems: true,
          },
        },
      },
    }),
    getCatalogVersion(tx),
  ]);
  const snapshot = profile?.currentSnapshot;
  if (!profile || !snapshot || snapshot.status !== DiscoverySnapshotStatus.READY) {
    return null;
  }

  const freshness = snapshot.libraryVersion === profile.libraryVersion
    && snapshot.catalogVersion >= Math.max(profile.requiredCatalogVersion, catalogVersion)
    ? "FRESH"
    : "STALE";
  const itemWhere: Prisma.DiscoverySnapshotItemWhereInput = {
    snapshotId: snapshot.id,
    song: { is: PUBLIC_SONG_WHERE },
  };
  const rows = await tx.discoverySnapshotItem.findMany({
    where: itemWhere,
    orderBy: { rank: "asc" },
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: { songId: true },
  });
  return {
    rows: rows.map((row) => ({ id: row.songId })),
    totalCount: await tx.discoverySnapshotItem.count({ where: itemWhere }),
    freshness,
  };
}

export async function rebuildDiscoveryProfile(
  userId: string,
  database: DiscoveryDatabase = getDb(),
  timing: DiscoveryMaterializerProfileTiming = getDiscoveryMaterializerTiming(),
): Promise<boolean> {
  const build = await database.$transaction(
    (tx) => startDiscoverySnapshot(tx, userId, new Date(), timing.buildLeaseMs),
    SHORT_TRANSACTION_OPTIONS,
  );
  if (!build) return false;

  try {
    const { seedCount, totalItems } = await database.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT set_config('statement_timeout', ${String(timing.statementTimeoutMs)}, true)`);
      const seedIds = await getDiscoverySeedIds(tx, userId);
      return {
        seedCount: seedIds.length,
        totalItems: seedIds.length > 0
          ? await insertRankedSnapshotItems(tx, build.snapshotId, seedIds)
          : 0,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: timing.buildTimeoutMs,
    });
    return database.$transaction(
      (tx) => publishDiscoverySnapshot(tx, userId, build, seedCount, totalItems),
      SHORT_TRANSACTION_OPTIONS,
    );
  } catch (error) {
    await database.$transaction(
      (tx) => failDiscoverySnapshot(tx, userId, build, error),
      SHORT_TRANSACTION_OPTIONS,
    );
    throw error;
  }
}

async function publishDiscoverySnapshot(
  tx: DiscoveryTransaction,
  userId: string,
  build: DiscoveryBuild,
  seedCount: number,
  totalItems: number,
): Promise<boolean> {
  const ready = await tx.discoverySnapshot.updateMany({
    where: { id: build.snapshotId, status: DiscoverySnapshotStatus.BUILDING },
    data: {
      status: DiscoverySnapshotStatus.READY,
      seedCount,
      totalItems,
      finishedAt: new Date(),
    },
  });
  if (ready.count !== 1) return false;

  const published = await tx.discoveryProfile.updateMany({
    where: {
      userId,
      libraryVersion: build.libraryVersion,
      requiredCatalogVersion: build.catalogVersion,
      refreshStartedAt: build.refreshStartedAt,
    },
    data: {
      currentSnapshotId: build.snapshotId,
      refreshStartedAt: null,
      lastRefreshError: null,
    },
  });
  if (published.count === 1) return true;

  await tx.discoverySnapshot.update({
    where: { id: build.snapshotId },
    data: {
      status: DiscoverySnapshotStatus.FAILED,
      errorCode: "STALE_BUILD",
      errorMessage: "Profile changed while snapshot was building",
      finishedAt: new Date(),
    },
  });
  await tx.discoveryProfile.updateMany({
    where: { userId, refreshStartedAt: build.refreshStartedAt },
    data: { refreshStartedAt: null },
  });
  return false;
}

async function failDiscoverySnapshot(
  tx: DiscoveryTransaction,
  userId: string,
  build: DiscoveryBuild,
  error: unknown,
): Promise<void> {
  await tx.discoverySnapshot.updateMany({
    where: { id: build.snapshotId, status: DiscoverySnapshotStatus.BUILDING },
    data: {
      status: DiscoverySnapshotStatus.FAILED,
      errorCode: "BUILD_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
      finishedAt: new Date(),
    },
  });
  await tx.discoveryProfile.updateMany({
    where: { userId, refreshStartedAt: build.refreshStartedAt },
    data: {
      refreshStartedAt: null,
      lastRefreshError: "BUILD_FAILED",
    },
  });
}

export async function materializeDiscoverySnapshots(
  limit: number,
  database: DiscoveryDatabase = getDb(),
  options: DiscoveryMaterializerOptions = {},
): Promise<DiscoveryMaterializerResult> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Discovery materializer limit must be a positive safe integer");
  }
  const timing = options.batchTiming ?? getDiscoveryMaterializerTiming();
  const batchTiming = options.batchTiming;
  const now = options.now ?? performance.now.bind(performance);
  const startedAt = now();
  const userIds = await database.$transaction(
    (tx) => findStaleDiscoveryProfileIds(tx, limit, timing.buildLeaseMs),
    SHORT_TRANSACTION_OPTIONS,
  );
  let attemptedCount = 0;
  let publishedCount = 0;
  let failedCount = 0;
  for (const userId of userIds) {
    if (
      batchTiming
      && now() - startedAt + batchTiming.attemptReservationMs > batchTiming.batchBudgetMs
    ) {
      break;
    }
    attemptedCount += 1;
    try {
      if (await rebuildDiscoveryProfile(userId, database, timing)) publishedCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  const deferredCount = userIds.length - attemptedCount;
  return {
    selectedCount: userIds.length,
    attemptedCount,
    publishedCount,
    failedCount,
    deferredCount,
    stopReason: userIds.length === 0
      ? "NO_STALE_PROFILES"
      : deferredCount > 0
        ? "BUDGET_EXHAUSTED"
        : userIds.length === limit
          ? "LIMIT_REACHED"
          : "QUEUE_DRAINED",
    batchBudgetMs: batchTiming?.batchBudgetMs ?? null,
    attemptReservationMs: batchTiming?.attemptReservationMs ?? null,
  };
}

async function startDiscoverySnapshot(
  tx: DiscoveryTransaction,
  userId: string,
  now: Date,
  buildLeaseMs: number,
): Promise<DiscoveryBuild | null> {
  const profile = await claimDiscoveryProfile(tx, userId, now, buildLeaseMs);
  if (!profile) return null;
  await failExpiredDiscoverySnapshots(tx, userId, now, buildLeaseMs);
  const snapshot = await tx.discoverySnapshot.create({
    data: {
      userId,
      libraryVersion: profile.libraryVersion,
      catalogVersion: profile.requiredCatalogVersion,
    },
    select: { id: true },
  });
  return {
    snapshotId: snapshot.id,
    libraryVersion: profile.libraryVersion,
    catalogVersion: profile.requiredCatalogVersion,
    refreshStartedAt: now,
  };
}

async function failExpiredDiscoverySnapshots(
  tx: DiscoveryTransaction,
  userId: string,
  now: Date,
  buildLeaseMs: number,
): Promise<void> {
  const expiredLeaseAt = new Date(now.getTime() - buildLeaseMs);
  await tx.discoverySnapshot.updateMany({
    where: {
      userId,
      status: DiscoverySnapshotStatus.BUILDING,
      startedAt: { lt: expiredLeaseAt },
    },
    data: {
      status: DiscoverySnapshotStatus.FAILED,
      errorCode: "BUILD_LEASE_EXPIRED",
      errorMessage: "Snapshot build lease expired before publication",
      finishedAt: now,
    },
  });
}

async function claimDiscoveryProfile(
  tx: DiscoveryTransaction,
  userId: string,
  now: Date,
  buildLeaseMs: number,
): Promise<{ libraryVersion: number; requiredCatalogVersion: number } | null> {
  const catalogVersion = await getCatalogVersion(tx);
  const expiredLeaseAt = new Date(now.getTime() - buildLeaseMs);
  const rows = await tx.$queryRaw<Array<{
    libraryVersion: number;
    requiredCatalogVersion: number;
  }>>(Prisma.sql`
    INSERT INTO "DiscoveryProfile" (
      "userId", "libraryVersion", "requiredCatalogVersion", "refreshStartedAt", "createdAt", "updatedAt"
    )
    SELECT ${userId}::uuid, 0, ${catalogVersion}, ${now}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE EXISTS (SELECT 1 FROM "User" WHERE id = ${userId}::uuid)
    ON CONFLICT ("userId") DO UPDATE
    SET "refreshStartedAt" = ${now},
        "requiredCatalogVersion" = GREATEST(
          "DiscoveryProfile"."requiredCatalogVersion",
          ${catalogVersion}
        ),
        "lastRefreshError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "DiscoveryProfile"."refreshStartedAt" IS NULL
       OR "DiscoveryProfile"."refreshStartedAt" < ${expiredLeaseAt}
    RETURNING "libraryVersion", "requiredCatalogVersion"
  `);
  return rows[0] ?? null;
}

async function findStaleDiscoveryProfileIds(
  tx: DiscoveryTransaction,
  limit: number,
  buildLeaseMs: number,
): Promise<string[]> {
  const expiredLeaseAt = new Date(Date.now() - buildLeaseMs);
  const rows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    ${staleDiscoveryCandidatesQuery(expiredLeaseAt)}
    SELECT "userId"
    FROM stale_candidates
    ORDER BY "profileUpdatedAt" ASC NULLS FIRST, "userId" ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => row.userId);
}

async function getCatalogVersion(tx: DiscoveryTransaction): Promise<number> {
  const state = await tx.discoveryCatalogState.findUnique({
    where: { id: DISCOVERY_CATALOG_STATE_ID },
    select: { version: true },
  });
  return state?.version ?? 0;
}

async function insertRankedSnapshotItems(
  tx: DiscoveryTransaction,
  snapshotId: string,
  seedIds: string[],
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ totalItems: number }>>(Prisma.sql`
    WITH seeds AS (
      SELECT value::uuid AS id FROM jsonb_array_elements_text(${JSON.stringify(seedIds)}::jsonb) AS value
    ),
    tag_scores AS (
      SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."tagId")::int AS shared_tags
      FROM "SongTag" candidate
      JOIN "SongTag" seed ON seed."tagId" = candidate."tagId"
      JOIN seeds ON seeds.id = seed."songId"
      GROUP BY candidate."songId"
    ),
    artist_scores AS (
      SELECT candidate."songId" AS id, COUNT(DISTINCT candidate."artistId")::int AS shared_artists
      FROM "SongArtistCredit" candidate
      JOIN "SongArtistCredit" seed ON seed."artistId" = candidate."artistId"
      JOIN seeds ON seeds.id = seed."songId"
      WHERE candidate."artistId" IS NOT NULL
        AND seed."artistId" IS NOT NULL
      GROUP BY candidate."songId"
    ),
    ranked AS (
      SELECT s.id,
        (COALESCE(t.shared_tags, 0) * 100 + COALESCE(a.shared_artists, 0) * 30
          + LEAST(s."favoritedTimes", 1000) + LEAST(s."ratingScore", 100))::int AS score
      FROM "Song" s
      LEFT JOIN tag_scores t ON t.id = s.id
      LEFT JOIN artist_scores a ON a.id = s.id
      WHERE s."sourceDeleted" = false
        AND s."lastSyncedAt" IS NOT NULL
        AND s."syncStatus" IN ('SYNCED', 'FAILED')
        AND NOT EXISTS (SELECT 1 FROM seeds WHERE seeds.id = s.id)
        AND (t.id IS NOT NULL OR a.id IS NOT NULL)
    ),
    inserted AS (
      INSERT INTO "DiscoverySnapshotItem" ("snapshotId", "rank", "songId", "score")
      SELECT ${snapshotId}::uuid,
        (ROW_NUMBER() OVER (ORDER BY score DESC, id ASC) - 1)::int,
        id,
        score
      FROM ranked
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "totalItems" FROM inserted
  `);
  return rows[0]?.totalItems ?? 0;
}
