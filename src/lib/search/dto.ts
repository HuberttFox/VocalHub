import type { ArtistListItemDto } from "@/lib/artists/list-dto";
import type { SongListItemDto } from "@/lib/songs/dto";
import type { TagListItemDto } from "@/lib/tags/dto";

export type SearchResultGroup<T> = {
  items: T[];
  totalItems: number;
  hasMore: boolean;
};

export type SearchResultsDto = {
  songs: SearchResultGroup<SongListItemDto>;
  artists: SearchResultGroup<ArtistListItemDto>;
  tags: SearchResultGroup<TagListItemDto>;
};
