import type { Prisma } from "@/generated/prisma/client";
import { SyncStatus } from "@/generated/prisma/enums";

export const PUBLIC_SONG_WHERE = {
  sourceDeleted: false,
  lastSyncedAt: { not: null },
  syncStatus: { in: [SyncStatus.SYNCED, SyncStatus.FAILED] },
} satisfies Prisma.SongWhereInput;

export const PUBLIC_ARTIST_SNAPSHOT_WHERE = {
  sourceDeleted: false,
  lastSyncedAt: { not: null },
  syncStatus: { in: [SyncStatus.SYNCED, SyncStatus.FAILED] },
} satisfies Prisma.ArtistWhereInput;

export const PUBLIC_ARTIST_WHERE = {
  ...PUBLIC_ARTIST_SNAPSHOT_WHERE,
  songCredits: {
    some: { song: { is: PUBLIC_SONG_WHERE } },
  },
} satisfies Prisma.ArtistWhereInput;
