import { createHash } from "node:crypto";
import type { ArtistListDto } from "@/lib/artists/list-dto";
import type { EntityListQuery } from "@/lib/catalog/entity-list-query";
import type { SearchResultsDto } from "@/lib/search/dto";
import type { TagListDto } from "@/lib/tags/dto";
import type { TagSongsDto } from "@/lib/tags/dto";
import type { ArtistWorksDto } from "@/lib/artists/dto";
import type { ArtistWorksQuery } from "@/lib/artists/works-query";
import {
  DISCOVERY_ALGORITHM_VERSION,
  type DiscoveryDto,
} from "@/lib/discover/dto";
import type { DiscoveryQuery } from "@/lib/discover/query";
import type { SongListDto } from "@/lib/songs/dto";
import type { SongListQuery } from "@/lib/songs/list-query";
import type {
  CatalogBenchmarkArtistMarker,
  CatalogBenchmarkMarker,
  CatalogBenchmarkSearchMarker,
} from "./types";

export const CATALOG_BENCHMARK_PAGE_SIZE = 24;
export const CATALOG_BENCHMARK_ARTIST_PAGE_SIZE = 10;
export const CATALOG_BENCHMARK_DEEP_PAGE_FRACTION = 0.8;

export type CatalogBenchmarkScenario =
  | {
      id: string;
      kind: "songs";
      query: SongListQuery;
      expectedTotalItems: number;
    }
  | {
      id: string;
      kind: "artist-works";
      artistId: string;
      query: ArtistWorksQuery;
      expectedTotalItems: number;
    }
  | {
      id: string;
      kind: "tag-works";
      tagId: string;
      query: ArtistWorksQuery;
      expectedTotalItems: number;
    }
  | {
      id: string;
      kind: "artist-list";
      query: EntityListQuery;
      expectedTotalItems: number;
    }
  | {
      id: string;
      kind: "tag-list";
      query: EntityListQuery;
      expectedTotalItems: number;
    }
  | {
      id: string;
      kind: "search-catalog";
      term: string;
      query: SongListQuery;
      expectedTotalItems: number;
      expectedGroupTotals: {
        songs: number;
        artists: number;
        tags: number;
      };
    }
  | {
      id: string;
      kind: "discovery";
      viewerId: string | null;
      query: DiscoveryQuery;
      expectedMode: DiscoveryDto["mode"];
      expectedAlgorithmVersion: DiscoveryDto["algorithmVersion"];
      expectedTotalItems: number;
    };

export type CatalogBenchmarkScenarioResult =
  | SongListDto
  | ArtistWorksDto
  | ArtistListDto
  | TagListDto
  | TagSongsDto
  | SearchResultsDto
  | DiscoveryDto
  | null;

export type CatalogBenchmarkResultCheck = {
  checksum: string;
  itemCount: number;
  totalItems: number;
  page: number;
  pageSize: number;
};

export type CatalogBenchmarkScenarioContext = {
  marker: Pick<CatalogBenchmarkMarker, "visibility" | "searchMarkers" | "artistMarkers"> & Partial<Pick<CatalogBenchmarkMarker, "artistSearchMarkers" | "tagMarkers" | "discoveryMarkers">>;
};

export function defineCatalogBenchmarkScenarios(
  context: CatalogBenchmarkScenarioContext,
  selectedIds?: ReadonlySet<string>,
): CatalogBenchmarkScenario[] {
  const marker = context.marker;
  const artistSearchMarkers = marker.artistSearchMarkers ?? {
    canonicalName: marker.searchMarkers.linkedArtistName,
    localizedName: marker.searchMarkers.linkedArtistName,
    exactAlias: marker.searchMarkers.linkedArtistName,
    aliasSubstringNoHit: marker.searchMarkers.noHit,
    noHit: marker.searchMarkers.noHit,
  };
  const discoveryMarkers = marker.discoveryMarkers ?? {
    viewerId: "",
    otherViewerId: "",
    favoriteCount: 0,
    playlistCount: 0,
    playlistSongCount: 0,
    collaboratorCount: 0,
    rawSeedCount: 0,
    deduplicatedSeedCount: 0,
    personalizedTotalItems: 0,
  };
  const publicSongCount = marker.visibility.publicSynced + marker.visibility.publicFailed;
  const deepSongPage = deepPageFor(publicSongCount, CATALOG_BENCHMARK_PAGE_SIZE);

  const tagScenarios = marker.tagMarkers ? [
    tagScenario("tag-works-high-latest-first-page", marker.tagMarkers.highFanout, 1, "latest"),
    tagScenario(
      "tag-works-high-latest-deep-page",
      marker.tagMarkers.highFanout,
      deepPageFor(marker.tagMarkers.highFanout.expectedPublicSongCount, CATALOG_BENCHMARK_PAGE_SIZE),
      "latest",
    ),
    tagScenario("tag-works-high-popular-first-page", marker.tagMarkers.highFanout, 1, "popular"),
    tagScenario("tag-works-medium-latest-first-page", marker.tagMarkers.mediumFanout, 1, "latest"),
    tagScenario("tag-works-sparse-latest-first-page", marker.tagMarkers.sparseFanout, 1, "latest"),
  ] : [];

  const scenarios = [
    songScenario("songs-latest-first-page", { page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "latest" }, publicSongCount),
    songScenario("songs-latest-deep-page", { page: deepSongPage, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "latest" }, publicSongCount),
    songScenario("songs-popular-first-page", { page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "popular" }, publicSongCount),
    songScenario("songs-popular-deep-page", { page: deepSongPage, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "popular" }, publicSongCount),
    searchScenario("songs-search-rare-title", marker.searchMarkers.rareTitle),
    searchScenario("songs-search-medium-default-title", marker.searchMarkers.mediumDefaultTitle),
    searchScenario("songs-search-cjk-alternate-name", marker.searchMarkers.cjkAlternateName),
    searchScenario("songs-search-common-artist-string", marker.searchMarkers.commonArtistString),
    searchScenario(
      "songs-search-common-artist-string-deep-page",
      marker.searchMarkers.commonArtistString,
      deepPageFor(
        marker.searchMarkers.commonArtistString.expectedPublicSongCount,
        CATALOG_BENCHMARK_PAGE_SIZE,
      ),
    ),
    searchScenario(
      "songs-search-common-artist-string-popular",
      marker.searchMarkers.commonArtistString,
      1,
      "popular",
    ),
    searchScenario("songs-search-literal-credit", marker.searchMarkers.literalCredit),
    searchScenario("songs-search-linked-artist-name", marker.searchMarkers.linkedArtistName),
    searchScenario("songs-search-rare-tag-name", marker.searchMarkers.rareTagName),
    searchScenario("songs-search-medium-tag-alias", marker.searchMarkers.mediumTagAlias),
    searchScenario("songs-search-no-hit", marker.searchMarkers.noHit),
    entityScenario("artists-search-canonical", artistSearchMarkers.canonicalName, "artist-list"),
    entityScenario("artists-search-localized", artistSearchMarkers.localizedName, "artist-list"),
    entityScenario("artists-search-exact-alias", artistSearchMarkers.exactAlias, "artist-list"),
    entityScenario("artists-search-alias-substring-no-hit", artistSearchMarkers.aliasSubstringNoHit, "artist-list"),
    entityScenario("artists-search-no-hit", artistSearchMarkers.noHit, "artist-list"),
    entityScenario("tags-search-rare-name", marker.searchMarkers.rareTagName, "tag-list"),
    entityScenario("tags-search-exact-alias", marker.searchMarkers.mediumTagAlias, "tag-list"),
    catalogSearchScenario("search-catalog-no-hit", marker.searchMarkers.noHit),
    catalogSearchScenario("search-catalog-cross-group", marker.searchMarkers.linkedArtistName),
    catalogSearchScenario("search-catalog-tag-alias", marker.searchMarkers.mediumTagAlias),
    discoveryScenario("discover-popular-first-page", null, 1, publicSongCount, "POPULAR"),
    discoveryScenario("discover-popular-deep-page", null, deepSongPage, publicSongCount, "POPULAR"),
    discoveryScenario(
      "discover-personalized-first-page",
      discoveryMarkers.viewerId,
      1,
      discoveryMarkers.personalizedTotalItems,
      discoveryMarkers.personalizedTotalItems > 0 ? "PERSONALIZED" : "POPULAR",
    ),
    discoveryScenario(
      "discover-personalized-deep-page",
      discoveryMarkers.viewerId,
      deepPageFor(discoveryMarkers.personalizedTotalItems, CATALOG_BENCHMARK_PAGE_SIZE),
      discoveryMarkers.personalizedTotalItems,
      discoveryMarkers.personalizedTotalItems > 0 ? "PERSONALIZED" : "POPULAR",
    ),
    artistScenario("artist-works-high-latest-first-page", marker.artistMarkers.highFanout, 1, "latest"),
    artistScenario(
      "artist-works-high-latest-deep-page",
      marker.artistMarkers.highFanout,
      deepPageFor(
        marker.artistMarkers.highFanout.expectedPublicSongCount,
        CATALOG_BENCHMARK_ARTIST_PAGE_SIZE,
      ),
      "latest",
    ),
    artistScenario("artist-works-high-popular-first-page", marker.artistMarkers.highFanout, 1, "popular"),
    artistScenario("artist-works-medium-latest-first-page", marker.artistMarkers.mediumFanout, 1, "latest"),
    artistScenario("artist-works-sparse-latest-first-page", marker.artistMarkers.sparseFanout, 1, "latest"),
    artistScenario("artist-works-duplicate-latest-first-page", marker.artistMarkers.duplicateCredits, 1, "latest"),
    ...tagScenarios,
  ];
  return selectedIds ? scenarios.filter(({ id }) => selectedIds.has(id)) : scenarios;
}

export function checkCatalogBenchmarkResult(
  scenario: CatalogBenchmarkScenario,
  result: CatalogBenchmarkScenarioResult,
): CatalogBenchmarkResultCheck {
  if (result === null) throw new Error(`Scenario ${scenario.id} returned no artist`);
  if (scenario.kind === "search-catalog") {
    const aggregate = result as SearchResultsDto;
    if (
      aggregate.songs.totalItems !== scenario.expectedGroupTotals.songs
      || aggregate.artists.totalItems !== scenario.expectedGroupTotals.artists
      || aggregate.tags.totalItems !== scenario.expectedGroupTotals.tags
    ) {
      throw new Error(`Scenario ${scenario.id} returned unexpected group totals`);
    }
    return {
      checksum: catalogBenchmarkResultChecksum(aggregate),
      itemCount: aggregate.songs.items.length + aggregate.artists.items.length + aggregate.tags.items.length,
      totalItems: aggregate.songs.totalItems + aggregate.artists.totalItems + aggregate.tags.totalItems,
      page: 1,
      pageSize: 6,
    };
  }
  if (scenario.kind === "discovery") {
    const discovery = result as DiscoveryDto;
    if (discovery.mode !== scenario.expectedMode || discovery.algorithmVersion !== scenario.expectedAlgorithmVersion) {
      throw new Error(`Scenario ${scenario.id} returned unexpected discovery mode/version`);
    }
    if (discovery.pagination.page !== scenario.query.page || discovery.pagination.pageSize !== scenario.query.pageSize) {
      throw new Error(`Scenario ${scenario.id} returned unexpected pagination`);
    }
    if (discovery.pagination.totalItems !== scenario.expectedTotalItems) {
      throw new Error(`Scenario ${scenario.id} returned unexpected discovery total`);
    }
    if (discovery.items.length > scenario.query.pageSize) {
      throw new Error(`Scenario ${scenario.id} returned too many items`);
    }
    if (discovery.pagination.totalPages !== Math.ceil(discovery.pagination.totalItems / discovery.pagination.pageSize)) {
      throw new Error(`Scenario ${scenario.id} returned inconsistent totals`);
    }
    return {
      checksum: catalogBenchmarkResultChecksum(discovery),
      itemCount: discovery.items.length,
      totalItems: discovery.pagination.totalItems,
      page: discovery.pagination.page,
      pageSize: discovery.pagination.pageSize,
    };
  }
  if (!("pagination" in result) || !("items" in result)) {
    throw new Error(`Scenario ${scenario.id} returned an unexpected result shape`);
  }
  if (result.pagination.page !== scenario.query.page || result.pagination.pageSize !== scenario.query.pageSize) {
    throw new Error(`Scenario ${scenario.id} returned unexpected pagination`);
  }
  if (result.items.length > scenario.query.pageSize) {
    throw new Error(`Scenario ${scenario.id} returned too many items`);
  }
  if (result.pagination.totalPages !== Math.ceil(result.pagination.totalItems / result.pagination.pageSize)) {
    throw new Error(`Scenario ${scenario.id} returned inconsistent totals`);
  }
  if (result.pagination.totalItems !== scenario.expectedTotalItems) {
    throw new Error(
      `Scenario ${scenario.id} expected ${scenario.expectedTotalItems} total items, received ${result.pagination.totalItems}`,
    );
  }

  return {
    checksum: catalogBenchmarkResultChecksum(result),
    itemCount: result.items.length,
    totalItems: result.pagination.totalItems,
    page: result.pagination.page,
    pageSize: result.pagination.pageSize,
  };
}

export function catalogBenchmarkResultChecksum(
  result: Exclude<CatalogBenchmarkScenarioResult, null>,
): string {
  return createHash("sha256")
    .update(JSON.stringify("songs" in result && "artists" in result && "tags" in result
      ? {
          songs: { ids: result.songs.items.map(({ id }) => id), totalItems: result.songs.totalItems, hasMore: result.songs.hasMore },
          artists: { ids: result.artists.items.map(({ id }) => id), totalItems: result.artists.totalItems, hasMore: result.artists.hasMore },
          tags: { ids: result.tags.items.map(({ id }) => id), totalItems: result.tags.totalItems, hasMore: result.tags.hasMore },
        }
      : "mode" in result
        ? {
            ids: result.items.map(({ id }) => id),
            mode: result.mode,
            algorithmVersion: result.algorithmVersion,
            pagination: result.pagination,
          }
        : {
          ids: result.items.map((item) => item.id),
          pagination: result.pagination,
        }))
    .digest("hex");
}

export function deepPageFor(totalItems: number, pageSize: number): number {
  if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
    throw new TypeError("totalItems must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError("pageSize must be a positive safe integer");
  }
  const totalPages = Math.ceil(totalItems / pageSize);
  return Math.max(1, Math.floor(totalPages * CATALOG_BENCHMARK_DEEP_PAGE_FRACTION));
}

function songScenario(
  id: string,
  query: SongListQuery,
  expectedTotalItems: number,
): CatalogBenchmarkScenario {
  return { id, kind: "songs", query, expectedTotalItems };
}

function searchScenario(
  id: string,
  marker: CatalogBenchmarkSearchMarker,
  page = 1,
  sort: SongListQuery["sort"] = "latest",
): CatalogBenchmarkScenario {
  return songScenario(id, {
    q: marker.term,
    page,
    pageSize: CATALOG_BENCHMARK_PAGE_SIZE,
    sort,
  }, marker.expectedPublicSongCount);
}

function entityScenario(
  id: string,
  marker: CatalogBenchmarkSearchMarker,
  kind: "artist-list" | "tag-list",
): CatalogBenchmarkScenario {
  return {
    id,
    kind,
    query: { q: marker.term, page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE },
    expectedTotalItems: marker.expectedPublicSongCount > 0 ? 1 : 0,
  };
}

function catalogSearchScenario(
  id: string,
  marker: CatalogBenchmarkSearchMarker,
): CatalogBenchmarkScenario {
  const expectedArtists = marker.branch === "artistCredits.artist.name"
    || marker.branch === "artist.name"
    || marker.branch === "artist.additionalNames"
    || marker.branch === "artist.names.value"
    ? 1
    : 0;
  const expectedTags = marker.branch === "tags.name" || marker.branch === "tags.additionalNames" ? 1 : 0;
  return {
    id,
    kind: "search-catalog",
    term: marker.term,
    query: { q: marker.term, page: 1, pageSize: 6, sort: "latest" },
    expectedTotalItems: marker.expectedPublicSongCount,
    expectedGroupTotals: {
      songs: marker.expectedPublicSongCount,
      artists: expectedArtists,
      tags: expectedTags,
    },
  };
}

function discoveryScenario(
  id: string,
  viewerId: string | null,
  page: number,
  expectedTotalItems: number,
  expectedMode: DiscoveryDto["mode"],
): CatalogBenchmarkScenario {
  return {
    id,
    kind: "discovery",
    viewerId,
    query: { page, pageSize: CATALOG_BENCHMARK_PAGE_SIZE },
    expectedMode,
    expectedAlgorithmVersion: DISCOVERY_ALGORITHM_VERSION,
    expectedTotalItems,
  };
}

function tagScenario(
  id: string,
  marker: NonNullable<CatalogBenchmarkMarker["tagMarkers"]>[keyof CatalogBenchmarkMarker["tagMarkers"]],
  page: number,
  sort: ArtistWorksQuery["sort"],
): CatalogBenchmarkScenario {
  return {
    id,
    kind: "tag-works",
    tagId: marker.tagId,
    query: { page, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort },
    expectedTotalItems: marker.expectedPublicSongCount,
  };
}

function artistScenario(
  id: string,
  marker: CatalogBenchmarkArtistMarker,
  page: number,
  sort: ArtistWorksQuery["sort"],
): CatalogBenchmarkScenario {
  return {
    id,
    kind: "artist-works",
    artistId: marker.artistId,
    query: { page, pageSize: CATALOG_BENCHMARK_ARTIST_PAGE_SIZE, sort },
    expectedTotalItems: marker.expectedPublicSongCount,
  };
}
