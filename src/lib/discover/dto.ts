import type { SongListItemDto } from "@/lib/songs/dto";

export const DISCOVERY_ALGORITHM_VERSION = 1;
export type DiscoveryMode = "PERSONALIZED" | "POPULAR";

export type DiscoveryDto = {
  items: SongListItemDto[];
  mode: DiscoveryMode;
  algorithmVersion: number;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
