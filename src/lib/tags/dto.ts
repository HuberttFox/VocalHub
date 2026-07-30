import type { SongListItemDto } from "@/lib/songs/dto";

export type TagListItemDto = {
  id: string;
  name: string;
  additionalNames: string[];
  publicSongCount: number;
};

export type TagListDto = {
  items: TagListItemDto[];
  query: { q: string | null };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type TagDetailDto = TagListItemDto;

export type TagSongsDto = {
  items: SongListItemDto[];
  query: { sort: "latest" | "popular" };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
