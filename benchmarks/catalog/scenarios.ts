import { createHash } from "node:crypto";
import type { ArtistWorksDto } from "@/lib/artists/dto";
import type { ArtistWorksQuery } from "@/lib/artists/works-query";
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
    };

export type CatalogBenchmarkScenarioResult = SongListDto | ArtistWorksDto | null;

export type CatalogBenchmarkResultCheck = {
  checksum: string;
  itemCount: number;
  totalItems: number;
  page: number;
  pageSize: number;
};

export type CatalogBenchmarkScenarioContext = {
  marker: Pick<CatalogBenchmarkMarker, "visibility" | "searchMarkers" | "artistMarkers">;
};

export function defineCatalogBenchmarkScenarios(
  context: CatalogBenchmarkScenarioContext,
  selectedIds?: ReadonlySet<string>,
): CatalogBenchmarkScenario[] {
  const marker = context.marker;
  const publicSongCount = marker.visibility.publicSynced + marker.visibility.publicFailed;
  const deepSongPage = deepPageFor(publicSongCount, CATALOG_BENCHMARK_PAGE_SIZE);

  const scenarios = [
    songScenario("songs-latest-first-page", { page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "latest" }, publicSongCount),
    songScenario("songs-latest-deep-page", { page: deepSongPage, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "latest" }, publicSongCount),
    songScenario("songs-popular-first-page", { page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "popular" }, publicSongCount),
    songScenario("songs-popular-deep-page", { page: deepSongPage, pageSize: CATALOG_BENCHMARK_PAGE_SIZE, sort: "popular" }, publicSongCount),
    searchScenario("songs-search-rare-title", marker.searchMarkers.rareTitle),
    searchScenario("songs-search-medium-default-title", marker.searchMarkers.mediumDefaultTitle),
    searchScenario("songs-search-cjk-alternate-name", marker.searchMarkers.cjkAlternateName),
    searchScenario("songs-search-common-artist-string", marker.searchMarkers.commonArtistString),
    searchScenario("songs-search-literal-credit", marker.searchMarkers.literalCredit),
    searchScenario("songs-search-linked-artist-name", marker.searchMarkers.linkedArtistName),
    searchScenario("songs-search-rare-tag-name", marker.searchMarkers.rareTagName),
    searchScenario("songs-search-medium-tag-alias", marker.searchMarkers.mediumTagAlias),
    searchScenario("songs-search-no-hit", marker.searchMarkers.noHit),
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
  ];
  return selectedIds ? scenarios.filter(({ id }) => selectedIds.has(id)) : scenarios;
}

export function checkCatalogBenchmarkResult(
  scenario: CatalogBenchmarkScenario,
  result: CatalogBenchmarkScenarioResult,
): CatalogBenchmarkResultCheck {
  if (result === null) throw new Error(`Scenario ${scenario.id} returned no artist`);
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
    .update(JSON.stringify({
      ids: result.items.map((item) => item.id),
      query: result.query,
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

function searchScenario(id: string, marker: CatalogBenchmarkSearchMarker): CatalogBenchmarkScenario {
  return songScenario(id, {
    q: marker.term,
    page: 1,
    pageSize: CATALOG_BENCHMARK_PAGE_SIZE,
    sort: "latest",
  }, marker.expectedPublicSongCount);
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
