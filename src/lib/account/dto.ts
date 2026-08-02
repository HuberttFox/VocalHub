import type { SongListItemDto } from "@/lib/songs/dto";

export const ACCOUNT_EXPORT_VERSION = 2;

export type AccountExportCollaborator = {
  playlistId: string;
  role: "EDITOR";
  createdAt: string;
};

export type AccountExportSong = {
  songId: string;
  available: boolean;
  song: SongListItemDto | null;
};

export type AccountExport = {
  type: "vocalhub-account-export";
  version: typeof ACCOUNT_EXPORT_VERSION;
  exportedAt: string;
  account: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    createdAt: string;
    providers: Array<{ provider: string; providerAccountId: string }>;
  };
  favorites: Array<AccountExportSong & { createdAt: string }>;
  collaboratorMemberships: AccountExportCollaborator[];
  playlists: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    entries: Array<AccountExportSong & { position: number; addedAt: string }>;
  }>;
};
