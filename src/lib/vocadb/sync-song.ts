import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import type { NormalizedVocaDbSong } from "@/lib/vocadb/normalize";

type DbClient = PrismaClient;

export type SyncSongResult = {
  id: string;
  vocadbId: number;
  status: (typeof SyncStatus)[keyof typeof SyncStatus];
  lastSyncedAt: Date;
};

export async function syncVocaDbSong(
  db: DbClient,
  input: NormalizedVocaDbSong,
  now = new Date(),
): Promise<SyncSongResult> {
  return db.$transaction(async (tx) => {
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
): Promise<void> {
  await db.song.updateMany({
    where: { vocadbId },
    data: {
      syncStatus: status,
      lastSyncError: message.slice(0, 500),
    },
  });
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
          artistType: credit.artist.artistType,
          sourceStatus: credit.artist.sourceStatus,
          sourceVersion: credit.artist.sourceVersion,
          sourceDeleted: credit.artist.sourceDeleted,
          sourceUpdatedAt: credit.artist.sourceUpdatedAt,
          lastSyncedAt: now,
          syncStatus: credit.artist.sourceDeleted
            ? SyncStatus.SOURCE_DELETED
            : SyncStatus.SYNCED,
        },
        update: {
          name: credit.artist.name,
          artistType: credit.artist.artistType,
          sourceStatus: credit.artist.sourceStatus,
          sourceVersion: credit.artist.sourceVersion,
          sourceDeleted: credit.artist.sourceDeleted,
          sourceUpdatedAt: credit.artist.sourceUpdatedAt,
          lastSyncedAt: now,
          syncStatus: credit.artist.sourceDeleted
            ? SyncStatus.SOURCE_DELETED
            : SyncStatus.SYNCED,
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
      ...(incomingIds.length > 0
        ? { vocadbId: { notIn: incomingIds } }
        : {}),
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
      ...(incomingTagIds.length > 0
        ? { tagId: { notIn: incomingTagIds } }
        : {}),
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
      ...(incomingIds.length > 0
        ? { vocadbId: { notIn: incomingIds } }
        : {}),
    },
  });
}
