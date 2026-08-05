import type { Prisma } from "@/generated/prisma/client";

export const CATALOG_BENCHMARK_DATASET_VERSION = 5;
export const CATALOG_BENCHMARK_MIN_SONGS = 5_000;
export const CATALOG_BENCHMARK_MAX_SONGS = 50_000;
export const CATALOG_BENCHMARK_TARGET_SONGS = 50_000;

export type CatalogBenchmarkDatasetOptions = {
  songCount: number;
  seed: number;
};

export type CatalogBenchmarkChunkOptions = CatalogBenchmarkDatasetOptions & {
  start: number;
  count: number;
};

export type CatalogBenchmarkSearchBranch =
  | "name"
  | "defaultName"
  | "names.value"
  | "artistString"
  | "artistCredits.name"
  | "artistCredits.artist.name"
  | "artist.name"
  | "artist.additionalNames"
  | "artist.names.value"
  | "tags.name"
  | "tags.additionalNames"
  | "none";

export type CatalogBenchmarkSearchMarker = {
  term: string;
  branch: CatalogBenchmarkSearchBranch;
  expectedPublicSongCount: number;
};

export type CatalogBenchmarkArtistMarker = {
  artistId: string;
  expectedPublicSongCount: number;
  expectedCreditCount: number;
};

export type CatalogBenchmarkTagMarker = {
  tagId: string;
  expectedPublicSongCount: number;
};

export type CatalogBenchmarkVisibilityCounts = {
  publicSynced: number;
  publicFailed: number;
  hiddenPending: number;
  hiddenSourceMissing: number;
  hiddenSourceDeletedStatus: number;
  hiddenSourceDeletedFlag: number;
  hiddenLastSyncedAtNull: number;
};

export type CatalogBenchmarkMarker = {
  kind: "vocalhub-catalog-benchmark";
  version: number;
  seed: number;
  songCount: number;
  artistCount: number;
  tagCount: number;
  nameCount: number;
  creditCount: number;
  songTagCount: number;
  artistNameCount: number;
  visibility: CatalogBenchmarkVisibilityCounts;
  searchMarkers: {
    rareTitle: CatalogBenchmarkSearchMarker;
    mediumDefaultTitle: CatalogBenchmarkSearchMarker;
    cjkAlternateName: CatalogBenchmarkSearchMarker;
    commonArtistString: CatalogBenchmarkSearchMarker;
    literalCredit: CatalogBenchmarkSearchMarker;
    linkedArtistName: CatalogBenchmarkSearchMarker;
    rareTagName: CatalogBenchmarkSearchMarker;
    mediumTagAlias: CatalogBenchmarkSearchMarker;
    noHit: CatalogBenchmarkSearchMarker;
  };
  artistSearchMarkers: {
    canonicalName: CatalogBenchmarkSearchMarker;
    localizedName: CatalogBenchmarkSearchMarker;
    exactAlias: CatalogBenchmarkSearchMarker;
    aliasSubstringNoHit: CatalogBenchmarkSearchMarker;
    noHit: CatalogBenchmarkSearchMarker;
  };
  artistMarkers: {
    highFanout: CatalogBenchmarkArtistMarker;
    mediumFanout: CatalogBenchmarkArtistMarker;
    sparseFanout: CatalogBenchmarkArtistMarker;
    duplicateCredits: CatalogBenchmarkArtistMarker;
  };
  tagMarkers: {
    highFanout: CatalogBenchmarkTagMarker;
    mediumFanout: CatalogBenchmarkTagMarker;
    sparseFanout: CatalogBenchmarkTagMarker;
  };
  discoveryMarkers: {
    viewerId: string;
    otherViewerId: string;
    favoriteCount: number;
    playlistCount: number;
    playlistSongCount: number;
    collaboratorCount: number;
    rawSeedCount: number;
    deduplicatedSeedCount: number;
    personalizedTotalItems: number;
  };
  checksum: string;
};

export type CatalogBenchmarkRelations = {
  users: Prisma.UserCreateManyInput[];
  favorites: Prisma.FavoriteCreateManyInput[];
  playlists: Prisma.PlaylistCreateManyInput[];
  playlistSongs: Prisma.PlaylistSongCreateManyInput[];
  playlistCollaborators: Prisma.PlaylistCollaboratorCreateManyInput[];
  songs: Prisma.SongCreateManyInput[];
  names: Prisma.SongNameCreateManyInput[];
  credits: Prisma.SongArtistCreditCreateManyInput[];
  songTags: Prisma.SongTagCreateManyInput[];
};

export type CatalogBenchmarkDataset = CatalogBenchmarkRelations & {
  artists: Prisma.ArtistCreateManyInput[];
  artistNames: Prisma.ArtistNameCreateManyInput[];
  tags: Prisma.TagCreateManyInput[];
  marker: CatalogBenchmarkMarker;
};

export type CatalogBenchmarkLoadOptions = CatalogBenchmarkDatasetOptions & {
  chunkSize?: number;
  confirmReset: string;
};

export type CatalogBenchmarkLoadResult = CatalogBenchmarkMarker;
