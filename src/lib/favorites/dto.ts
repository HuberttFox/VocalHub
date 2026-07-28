import type { SongListItemDto } from "@/lib/songs/dto";

export type FavoriteItemDto = {
  songId: string;
  createdAt: string;
  available: boolean;
  song: SongListItemDto | null;
};

export type FavoriteListDto = {
  items: FavoriteItemDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
