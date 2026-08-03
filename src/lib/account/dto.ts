import type { SongListItemDto } from "@/lib/songs/dto";

export const ACCOUNT_EXPORT_VERSION = 3;

export type AccountExportReport = {
  id: string;
  playlistId: string;
  reason: "ILLEGAL" | "ABUSIVE" | "PERSONAL_DATA" | "SPAM" | "OTHER";
  note: string | null;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  resolvedAt: string | null;
};
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
  reports: AccountExportReport[];
  playlists: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    entries: Array<AccountExportSong & { position: number; addedAt: string }>;
  }>;
};
