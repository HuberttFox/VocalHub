import type { PrismaClient } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";
import type { NormalizedVocaDbArtist } from "@/lib/vocadb/normalize";

type DbClient = PrismaClient;

export type SyncArtistResult = {
  id: string;
  vocadbId: number;
  status: (typeof SyncStatus)[keyof typeof SyncStatus];
  lastSyncedAt: Date;
};

export async function syncVocaDbArtistDetail(
  db: DbClient,
  input: NormalizedVocaDbArtist,
  now = new Date(),
): Promise<SyncArtistResult> {
  return db.$transaction(async (tx) => {
    const status = input.sourceDeleted
      ? SyncStatus.SOURCE_DELETED
      : SyncStatus.SYNCED;
    const updated = await tx.artist.updateMany({
      where: { vocadbId: input.vocadbId },
      data: {
        name: input.name,
        defaultName: input.defaultName,
        defaultNameLanguage: input.defaultNameLanguage,
        additionalNames: input.additionalNames,
        description: input.description,
        artistType: input.artistType,
        sourceStatus: input.sourceStatus,
        sourceVersion: input.sourceVersion,
        sourceDeleted: input.sourceDeleted,
        sourceCreatedAt: input.sourceCreatedAt,
        releaseDate: input.releaseDate,
        mergedToVocaDbId: input.mergedToVocaDbId,
        pictureMime: input.pictureMime,
        pictureUrlOriginal: input.pictureUrlOriginal,
        pictureUrlThumb: input.pictureUrlThumb,
        pictureUrlSmallThumb: input.pictureUrlSmallThumb,
        pictureUrlTinyThumb: input.pictureUrlTinyThumb,
        detailLastAttemptAt: now,
        detailLastSyncedAt: now,
        lastSyncedAt: now,
        syncStatus: status,
        lastSyncError: null,
      },
    });
    if (updated.count !== 1) {
      throw new Error(`Local artist ${input.vocadbId} does not exist`);
    }

    const artist = await tx.artist.findUniqueOrThrow({
      where: { vocadbId: input.vocadbId },
      select: { id: true, vocadbId: true },
    });
    await tx.artistName.deleteMany({ where: { artistId: artist.id } });
    await tx.artistWebLink.deleteMany({ where: { artistId: artist.id } });
    if (input.names.length > 0) {
      await tx.artistName.createMany({
        data: input.names.map((name) => ({ ...name, artistId: artist.id })),
      });
    }
    if (input.webLinks.length > 0) {
      await tx.artistWebLink.createMany({
        data: input.webLinks.map((link) => ({ ...link, artistId: artist.id })),
      });
    }

    return {
      id: artist.id,
      vocadbId: artist.vocadbId,
      status,
      lastSyncedAt: now,
    };
  });
}

export async function markArtistSyncFailure(
  db: DbClient,
  vocadbId: number,
  status: typeof SyncStatus.FAILED | typeof SyncStatus.SOURCE_MISSING,
  message: string,
  now = new Date(),
): Promise<void> {
  await db.artist.updateMany({
    where: { vocadbId },
    data: {
      syncStatus: status,
      detailLastAttemptAt: now,
      lastSyncError: message.slice(0, 500),
    },
  });
}
