import type { SongListItemDto } from "@/lib/songs/dto";

export type PlaylistSummaryDto = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type PlaylistEntryDto = {
  songId: string;
  position: number;
  addedAt: string;
  available: boolean;
  song: SongListItemDto | null;
};

export type PlaylistDetailDto = PlaylistSummaryDto & {
  entries: PlaylistEntryDto[];
};
