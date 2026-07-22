import type { Prisma } from "@/generated/prisma/client";

export const CATALOG_BENCHMARK_DATASET_VERSION = 3;
export const CATALOG_BENCHMARK_MIN_SONGS = 5_000;
export const CATALOG_BENCHMARK_MAX_SONGS = 20_000;

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
  artistMarkers: {
    highFanout: CatalogBenchmarkArtistMarker;
    mediumFanout: CatalogBenchmarkArtistMarker;
    sparseFanout: CatalogBenchmarkArtistMarker;
    duplicateCredits: CatalogBenchmarkArtistMarker;
  };
  checksum: string;
};

export type CatalogBenchmarkRelations = {
  songs: Prisma.SongCreateManyInput[];
  names: Prisma.SongNameCreateManyInput[];
  credits: Prisma.SongArtistCreditCreateManyInput[];
  songTags: Prisma.SongTagCreateManyInput[];
};

export type CatalogBenchmarkDataset = CatalogBenchmarkRelations & {
  artists: Prisma.ArtistCreateManyInput[];
  tags: Prisma.TagCreateManyInput[];
  marker: CatalogBenchmarkMarker;
};

export type CatalogBenchmarkLoadOptions = CatalogBenchmarkDatasetOptions & {
  chunkSize?: number;
  confirmReset: string;
};

export type CatalogBenchmarkLoadResult = CatalogBenchmarkMarker;
