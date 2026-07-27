import type { SongListItemDto } from "@/lib/songs/dto";

export type ArtistSummaryDto = {
  id: string;
  name: string;
  artistType: string;
};

export type ArtistDetailDto = ArtistSummaryDto & {
  vocadbId: number;
  defaultName: string;
  defaultNameLanguage: string;
  description: string | null;
  aliases: Array<{ language: string | null; value: string }>;
  avatar: {
    urlOriginal: string | null;
    urlThumb: string | null;
    urlSmallThumb: string | null;
    urlTinyThumb: string | null;
    mime: string | null;
  } | null;
  webLinks: Array<{
    id: string;
    url: string;
    description: string;
    category: string;
  }>;
  worksCount: number;
  source: {
    provider: "VocaDB";
    url: string;
    version: number;
    sourceUpdatedAt: string | null;
    lastSyncedAt: string | null;
  };
};

export type ArtistWorkItemDto = SongListItemDto & {
  artistCredits: Array<{
    name: string;
    categories: string[];
    roles: string[];
    effectiveRoles: string[];
    isSupport: boolean;
    isCustomName: boolean;
  }>;
};

export type ArtistWorksDto = {
  artist: ArtistSummaryDto;
  items: ArtistWorkItemDto[];
  query: { sort: "latest" | "popular" };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
