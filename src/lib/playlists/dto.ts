import type { SongListItemDto } from "@/lib/songs/dto";

export type PlaylistRole = "OWNER" | "EDITOR";

export type PlaylistCollaboratorDto = {
  userId: string;
  role: "EDITOR";
  createdAt: string;
};

export type PlaylistSummaryDto = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  visibility: "PRIVATE" | "PUBLIC";
  shareToken: string | null;
  role: PlaylistRole;
};

export type PlaylistEntryDto = {
  songId: string;
  position: number;
  addedAt: string;
  available: boolean;
  song: SongListItemDto | null;
};

export type PlaylistDetailDto = PlaylistSummaryDto & {
  collaborators: PlaylistCollaboratorDto[];
  entries: PlaylistEntryDto[];
};

export type PublicPlaylistDto = {
  id: string;
  name: string;
  description: string | null;
  entries: PlaylistEntryDto[];
};
