export type SongCreditDto = {
  name: string;
  categories: string[];
  roles: string[];
  effectiveRoles: string[];
  isSupport: boolean;
  isCustomName: boolean;
  artist: {
    id: string;
    vocadbId: number;
    name: string;
    artistType: string;
  } | null;
};

export type SongListItemDto = {
  id: string;
  title: string;
  names: Array<{ language: string; value: string }>;
  artistString: string;
  credits: Array<{
    name: string;
    artistId: string | null;
    isSupport: boolean;
    isCustomName: boolean;
  }>;
  tags: Array<{ id: string; name: string }>;
  songType: string;
  publishDate: string | null;
  durationSeconds: number;
  favoritedTimes: number;
  ratingScore: number;
};

export type SongListDto = {
  items: SongListItemDto[];
  query: {
    q: string | null;
    sort: "latest" | "popular";
  };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type SongDetailDto = {
  id: string;
  vocadbId: number;
  title: string;
  defaultTitle: string;
  defaultNameLanguage: string;
  names: Array<{ language: string; value: string }>;
  artistString: string;
  credits: SongCreditDto[];
  tags: Array<{
    id: string;
    vocadbId: number;
    name: string;
    additionalNames: string[];
    categoryName: string | null;
    urlSlug: string | null;
    count: number;
  }>;
  pvs: Array<{
    id: string;
    vocadbId: number;
    externalId: string;
    service: string;
    pvType: string;
    url: string;
    name: string | null;
    author: string | null;
    publishDate: string | null;
    durationSeconds: number | null;
  }>;
  songType: string;
  publishDate: string | null;
  durationSeconds: number;
  favoritedTimes: number;
  ratingScore: number;
  source: {
    provider: "VocaDB";
    url: string;
    version: number;
    sourceUpdatedAt: string | null;
    lastSyncedAt: string | null;
    deleted: boolean;
  };
};
