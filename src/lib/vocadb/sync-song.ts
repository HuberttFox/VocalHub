import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import { invalidateDiscoveryCatalog } from "@/lib/discover/materializer";
import type { NormalizedVocaDbSong } from "@/lib/vocadb/normalize";

type DbClient = PrismaClient;

export type SyncSongResult = {
  id: string;
  vocadbId: number;
  status: (typeof SyncStatus)[keyof typeof SyncStatus];
  lastSyncedAt: Date;
};

type SongSyncOptions = {
  invalidateDiscoveryCatalog?: boolean;
  syncRunId?: string;
};

const DISCOVERY_FAVORITED_TIMES_CAP = 1_000;
const DISCOVERY_RATING_SCORE_CAP = 100;

type SongDiscoveryProjection = {
  publicVisible: boolean;
  favoritedTimes: number;
  ratingScore: number;
  tagIds: string[];
  artistIds: string[];
};

export async function syncVocaDbSong(
  db: DbClient,
  input: NormalizedVocaDbSong,
  now = new Date(),
  options: SongSyncOptions = {},
): Promise<SyncSongResult> {
  return db.$transaction(async (tx) => {
    const before = await readDiscoveryProjection(tx, input.vocadbId);
    const song = await tx.song.upsert({
      where: { vocadbId: input.vocadbId },
      create: {
        ...songScalars(input, now),
        syncStatus: input.sourceDeleted
          ? SyncStatus.SOURCE_DELETED
          : SyncStatus.SYNCED,
      },
      update: {
        ...songScalars(input, now),
        syncStatus: input.sourceDeleted
          ? SyncStatus.SOURCE_DELETED
          : SyncStatus.SYNCED,
        lastSyncError: null,
      },
    });

    await replaceNames(tx, song.id, input);
    await syncCredits(tx, song.id, input, now);
    await syncTags(tx, song.id, input, now);
    await syncPvs(tx, song.id, input, now);
    const after = await readDiscoveryProjection(tx, input.vocadbId);
    if (discoveryProjectionChanged(before, after)) {
      await recordCatalogChange(tx, options);
    }

    return {
      id: song.id,
      vocadbId: song.vocadbId,
      status: input.sourceDeleted
        ? SyncStatus.SOURCE_DELETED
        : SyncStatus.SYNCED,
      lastSyncedAt: now,
    };
  });
}

export async function markSongSyncFailure(
  db: DbClient,
  vocadbId: number,
  status: typeof SyncStatus.FAILED | typeof SyncStatus.SOURCE_MISSING,
  message: string,
  options: SongSyncOptions = {},
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const before = await readDiscoveryProjection(tx, vocadbId);
    const updated = await tx.song.updateMany({
      where: { vocadbId },
      data: {
        syncStatus: status,
        lastSyncError: message.slice(0, 500),
      },
    });
    if (updated.count > 0) {
      const after = await readDiscoveryProjection(tx, vocadbId);
      if (discoveryProjectionChanged(before, after)) {
        await recordCatalogChange(tx, options);
      }
    }
    return updated.count > 0;
  });
}

export async function markSongSourceDeleted(
  db: DbClient,
  vocadbId: number,
  message: string,
  options: SongSyncOptions = {},
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const before = await readDiscoveryProjection(tx, vocadbId);
    const updated = await tx.song.updateMany({
      where: { vocadbId },
      data: {
        sourceDeleted: true,
        syncStatus: SyncStatus.SOURCE_DELETED,
        lastSyncError: message.slice(0, 500),
      },
    });
    if (updated.count > 0) {
      const after = await readDiscoveryProjection(tx, vocadbId);
      if (discoveryProjectionChanged(before, after)) {
        await recordCatalogChange(tx, options);
      }
    }
    return updated.count > 0;
  });
}

async function readDiscoveryProjection(
  tx: Prisma.TransactionClient,
  vocadbId: number,
): Promise<SongDiscoveryProjection | null> {
  const song = await tx.song.findUnique({
    where: { vocadbId },
    select: {
      sourceDeleted: true,
      lastSyncedAt: true,
      syncStatus: true,
      favoritedTimes: true,
      ratingScore: true,
      tags: { select: { tagId: true } },
      artistCredits: { select: { artistId: true } },
    },
  });
  if (!song) return null;

  return {
    publicVisible:
      !song.sourceDeleted &&
      song.lastSyncedAt !== null &&
      (song.syncStatus === SyncStatus.SYNCED || song.syncStatus === SyncStatus.FAILED),
    favoritedTimes: Math.min(song.favoritedTimes, DISCOVERY_FAVORITED_TIMES_CAP),
    ratingScore: Math.min(song.ratingScore, DISCOVERY_RATING_SCORE_CAP),
    tagIds: [...new Set(song.tags.map((tag) => tag.tagId))].sort(),
    artistIds: [...new Set(
      song.artistCredits
        .map((credit) => credit.artistId)
        .filter((artistId): artistId is string => artistId !== null),
    )].sort(),
  };
}

function discoveryProjectionChanged(
  before: SongDiscoveryProjection | null,
  after: SongDiscoveryProjection | null,
): boolean {
  if (before === null || after === null) return before !== after;
  return (
    before.publicVisible !== after.publicVisible ||
    before.favoritedTimes !== after.favoritedTimes ||
    before.ratingScore !== after.ratingScore ||
    !sameIds(before.tagIds, after.tagIds) ||
    !sameIds(before.artistIds, after.artistIds)
  );
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function recordCatalogChange(
  tx: Prisma.TransactionClient,
  options: SongSyncOptions,
): Promise<void> {
  if (options.syncRunId) {
    await tx.syncRun.update({
      where: { id: options.syncRunId },
      data: { catalogChanged: true },
    });
  } else if (options.invalidateDiscoveryCatalog !== false) {
    await invalidateDiscoveryCatalog(tx);
  }
}

function songScalars(input: NormalizedVocaDbSong, now: Date) {
  return {
    vocadbId: input.vocadbId,
    name: input.name,
    defaultName: input.defaultName,
    defaultNameLanguage: input.defaultNameLanguage,
    artistString: input.artistString,
    songType: input.songType,
    sourceStatus: input.sourceStatus,
    sourceDeleted: input.sourceDeleted,
    sourceCreatedAt: input.sourceCreatedAt,
    publishDate: input.publishDate,
    durationSeconds: input.durationSeconds,
    favoritedTimes: input.favoritedTimes,
    ratingScore: input.ratingScore,
    originalVersionId: input.originalVersionId,
    cultureCodes: input.cultureCodes,
    coverUrlOriginal: input.coverUrlOriginal,
    coverUrlThumb: input.coverUrlThumb,
    sourceVersion: input.sourceVersion,
    sourceUpdatedAt: input.sourceUpdatedAt,
    lastSyncedAt: now,
  };
}

async function replaceNames(
  tx: Prisma.TransactionClient,
  songId: string,
  input: NormalizedVocaDbSong,
) {
  await tx.songName.deleteMany({ where: { songId } });
  if (input.names.length > 0) {
    await tx.songName.createMany({
      data: input.names.map((name) => ({ ...name, songId })),
    });
  }
}

async function syncCredits(
  tx: Prisma.TransactionClient,
  songId: string,
  input: NormalizedVocaDbSong,
  now: Date,
) {
  const incomingIds = input.artistCredits.map((credit) => credit.vocadbId);

  for (const credit of input.artistCredits) {
    let artistId: string | null = null;

    if (credit.artist) {
      const artist = await tx.artist.upsert({
        where: { vocadbId: credit.artist.vocadbId },
        create: {
          vocadbId: credit.artist.vocadbId,
          name: credit.artist.name,
          defaultName: credit.artist.name,
          defaultNameLanguage: "Unspecified",
          additionalNames: credit.artist.additionalNames,
          artistType: credit.artist.artistType,
          sourceStatus: credit.artist.sourceStatus,
          sourceVersion: credit.artist.sourceVersion,
          sourceDeleted: credit.artist.sourceDeleted,
          sourceUpdatedAt: credit.artist.sourceUpdatedAt,
          lastSyncedAt: now,
          syncStatus: credit.artist.sourceDeleted
            ? SyncStatus.SOURCE_DELETED
            : SyncStatus.SYNCED,
          summaryName: credit.artist.name,
          summaryArtistType: credit.artist.artistType,
          summaryAdditionalNames: credit.artist.additionalNames,
          summarySourceStatus: credit.artist.sourceStatus,
          summarySourceVersion: credit.artist.sourceVersion,
          summarySourceDeleted: credit.artist.sourceDeleted,
          summaryObservedAt: now,
        },
        update: {
          summaryName: credit.artist.name,
          summaryArtistType: credit.artist.artistType,
          summaryAdditionalNames: credit.artist.additionalNames,
          summarySourceStatus: credit.artist.sourceStatus,
          summarySourceVersion: credit.artist.sourceVersion,
          summarySourceDeleted: credit.artist.sourceDeleted,
          summaryObservedAt: now,
        },
      });
      artistId = artist.id;
    }

    await tx.songArtistCredit.upsert({
      where: {
        songId_vocadbId: { songId, vocadbId: credit.vocadbId },
      },
      create: {
        songId,
        artistId,
        vocadbId: credit.vocadbId,
        name: credit.name,
        categories: credit.categories,
        roles: credit.roles,
        effectiveRoles: credit.effectiveRoles,
        isSupport: credit.isSupport,
        isCustomName: credit.isCustomName,
        position: credit.position,
      },
      update: {
        artistId,
        name: credit.name,
        categories: credit.categories,
        roles: credit.roles,
        effectiveRoles: credit.effectiveRoles,
        isSupport: credit.isSupport,
        isCustomName: credit.isCustomName,
        position: credit.position,
      },
    });
  }

  await tx.songArtistCredit.deleteMany({
    where: {
      songId,
      vocadbId: { notIn: incomingIds },
    },
  });
}

async function syncTags(
  tx: Prisma.TransactionClient,
  songId: string,
  input: NormalizedVocaDbSong,
  now: Date,
) {
  const incomingTagIds: string[] = [];

  for (const entry of input.tags) {
    const tag = await tx.tag.upsert({
      where: { vocadbId: entry.vocadbId },
      create: {
        vocadbId: entry.vocadbId,
        name: entry.name,
        additionalNames: entry.additionalNames,
        categoryName: entry.categoryName,
        urlSlug: entry.urlSlug,
        lastSyncedAt: now,
      },
      update: {
        name: entry.name,
        additionalNames: entry.additionalNames,
        categoryName: entry.categoryName,
        urlSlug: entry.urlSlug,
        lastSyncedAt: now,
      },
    });
    incomingTagIds.push(tag.id);

    await tx.songTag.upsert({
      where: { songId_tagId: { songId, tagId: tag.id } },
      create: {
        songId,
        tagId: tag.id,
        count: entry.count,
        position: entry.position,
      },
      update: {
        count: entry.count,
        position: entry.position,
      },
    });
  }

  await tx.songTag.deleteMany({
    where: {
      songId,
      tagId: { notIn: incomingTagIds },
    },
  });
}

async function syncPvs(
  tx: Prisma.TransactionClient,
  songId: string,
  input: NormalizedVocaDbSong,
  now: Date,
) {
  const incomingIds = input.pvs.map((pv) => pv.vocadbId);

  for (const pv of input.pvs) {
    await tx.songPV.upsert({
      where: { songId_vocadbId: { songId, vocadbId: pv.vocadbId } },
      create: {
        songId,
        vocadbId: pv.vocadbId,
        externalId: pv.externalId,
        service: pv.service,
        pvType: pv.pvType,
        url: pv.url,
        name: pv.name,
        author: pv.author,
        thumbnailUrl: pv.thumbnailUrl,
        publishDate: pv.publishDate,
        durationSeconds: pv.durationSeconds,
        disabled: pv.disabled,
        position: pv.position,
        lastSyncedAt: now,
      },
      update: {
        externalId: pv.externalId,
        service: pv.service,
        pvType: pv.pvType,
        url: pv.url,
        name: pv.name,
        author: pv.author,
        thumbnailUrl: pv.thumbnailUrl,
        publishDate: pv.publishDate,
        durationSeconds: pv.durationSeconds,
        disabled: pv.disabled,
        position: pv.position,
        lastSyncedAt: now,
      },
    });
  }

  await tx.songPV.deleteMany({
    where: {
      songId,
      vocadbId: { notIn: incomingIds },
    },
  });
}
