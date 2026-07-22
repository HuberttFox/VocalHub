import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATALOG_BENCHMARK_ARTIST_PAGE_SIZE,
  CATALOG_BENCHMARK_DEEP_PAGE_FRACTION,
  CATALOG_BENCHMARK_PAGE_SIZE,
  catalogBenchmarkResultChecksum,
  checkCatalogBenchmarkResult,
  deepPageFor,
  defineCatalogBenchmarkScenarios,
  type CatalogBenchmarkScenario,
} from "../../benchmarks/catalog/scenarios";
import type { SongListDto } from "@/lib/songs/dto";
import type { CatalogBenchmarkMarker } from "../../benchmarks/catalog/types";

const ARTIST_IDS = {
  high: "00000000-0000-4000-8000-000000000001",
  medium: "00000000-0000-4000-8000-000000000002",
  sparse: "00000000-0000-4000-8000-000000000003",
  duplicate: "00000000-0000-4000-8000-000000000004",
};

function marker(): Pick<CatalogBenchmarkMarker, "visibility" | "searchMarkers" | "artistMarkers"> {
  const search = (term: string) => ({ term, branch: "name" as const, expectedPublicSongCount: 1 });
  const artist = (artistId: string, count: number, credits = count) => ({
    artistId,
    expectedPublicSongCount: count,
    expectedCreditCount: credits,
  });
  return {
    visibility: {
      publicSynced: 4_900,
      publicFailed: 80,
      hiddenPending: 4,
      hiddenSourceMissing: 4,
      hiddenSourceDeletedStatus: 4,
      hiddenSourceDeletedFlag: 4,
      hiddenLastSyncedAtNull: 4,
    },
    searchMarkers: {
      rareTitle: search("rare-title"),
      mediumDefaultTitle: search("medium-default-title"),
      cjkAlternateName: search("中文别名"),
      commonArtistString: search("common-artist-string"),
      literalCredit: search("100% literal_credit"),
      linkedArtistName: search("linked-artist-name"),
      rareTagName: search("rare-tag-name"),
      mediumTagAlias: search("medium-tag-alias"),
      noHit: { ...search("no-hit"), branch: "none", expectedPublicSongCount: 0 },
    },
    artistMarkers: {
      highFanout: artist(ARTIST_IDS.high, 123),
      mediumFanout: artist(ARTIST_IDS.medium, 18),
      sparseFanout: artist(ARTIST_IDS.sparse, 1),
      duplicateCredits: artist(ARTIST_IDS.duplicate, 8, 16),
    },
  };
}

function scenarios() {
  return defineCatalogBenchmarkScenarios({ marker: marker() });
}

function songResult(scenario: CatalogBenchmarkScenario): SongListDto {
  return {
    items: [{
      id: "00000000-0000-4000-8000-000000000005",
      title: "Synthetic result",
      names: [],
      artistString: "Synthetic Artist",
      credits: [],
      tags: [],
      coverUrlOriginal: null,
      coverUrlThumb: null,
      songType: "Original",
      publishDate: null,
      durationSeconds: 180,
      favoritedTimes: 2,
      ratingScore: 3,
    }],
    query: {
      q: scenario.kind === "songs" ? scenario.query.q ?? null : null,
      sort: scenario.query.sort,
    },
    pagination: {
      page: scenario.query.page,
      pageSize: scenario.query.pageSize,
      totalItems: scenario.expectedTotalItems,
      totalPages: Math.ceil(scenario.expectedTotalItems / scenario.query.pageSize),
    },
  };
}

describe("catalog benchmark scenarios", () => {
  it("defines stable named scenarios for every marker search and artist density", () => {
    const first = scenarios();
    expect(scenarios()).toEqual(first);
    expect(first.map(({ id }) => id)).toEqual([
      "songs-latest-first-page", "songs-latest-deep-page",
      "songs-popular-first-page", "songs-popular-deep-page",
      "songs-search-rare-title", "songs-search-medium-default-title",
      "songs-search-cjk-alternate-name", "songs-search-common-artist-string",
      "songs-search-literal-credit", "songs-search-linked-artist-name",
      "songs-search-rare-tag-name",
      "songs-search-medium-tag-alias", "songs-search-no-hit",
      "artist-works-high-latest-first-page", "artist-works-high-latest-deep-page",
      "artist-works-high-popular-first-page", "artist-works-medium-latest-first-page",
      "artist-works-sparse-latest-first-page", "artist-works-duplicate-latest-first-page",
    ]);
    expect(
      first.filter((scenario): scenario is Extract<CatalogBenchmarkScenario, { kind: "artist-works" }> =>
        scenario.kind === "artist-works").map(({ artistId }) => artistId),
    ).toEqual([
      ARTIST_IDS.high, ARTIST_IDS.high, ARTIST_IDS.high,
      ARTIST_IDS.medium, ARTIST_IDS.sparse, ARTIST_IDS.duplicate,
    ]);
  });

  it("derives deep pages from marker public and per-artist counts", () => {
    const result = scenarios();
    const songDeepPage = Math.floor(
      Math.ceil(4_980 / CATALOG_BENCHMARK_PAGE_SIZE) * CATALOG_BENCHMARK_DEEP_PAGE_FRACTION,
    );
    expect(result.find(({ id }) => id === "songs-latest-deep-page")?.query.page).toBe(songDeepPage);
    expect(result.find(({ id }) => id === "artist-works-high-latest-deep-page")?.query).toEqual({
      page: deepPageFor(123, CATALOG_BENCHMARK_ARTIST_PAGE_SIZE),
      pageSize: CATALOG_BENCHMARK_ARTIST_PAGE_SIZE,
      sort: "latest",
    });
    expect(deepPageFor(0, 10)).toBe(1);
    expect(() => deepPageFor(-1, 10)).toThrow();
  });

  it("uses exact dataset search marker terms", () => {
    const searches = scenarios().filter(
      (scenario): scenario is Extract<CatalogBenchmarkScenario, { kind: "songs" }> =>
        scenario.id.startsWith("songs-search"),
    );
    expect(searches.map(({ query }) => query.q)).toEqual([
      "rare-title", "medium-default-title", "中文别名", "common-artist-string",
      "100% literal_credit", "linked-artist-name", "rare-tag-name",
      "medium-tag-alias", "no-hit",
    ]);
  });

  it("filters scenarios without changing their definitions", () => {
    const selected = new Set(["songs-latest-first-page", "songs-search-no-hit"]);
    expect(defineCatalogBenchmarkScenarios({ marker: marker() }, selected).map(({ id }) => id))
      .toEqual([...selected]);
    expect(defineCatalogBenchmarkScenarios({ marker: marker() }, new Set())).toEqual([]);
  });

  it("checks pagination invariants and emits a reproducible SHA-256 checksum", () => {
    const scenario = scenarios()[0];
    const result = songResult(scenario);
    const expected = createHash("sha256").update(JSON.stringify({
      ids: result.items.map(({ id }) => id), query: result.query, pagination: result.pagination,
    })).digest("hex");
    expect(checkCatalogBenchmarkResult(scenario, result)).toEqual({
      checksum: expected, itemCount: 1, totalItems: scenario.expectedTotalItems,
      page: 1, pageSize: CATALOG_BENCHMARK_PAGE_SIZE,
    });
    expect(catalogBenchmarkResultChecksum(result)).toBe(expected);
  });

  it("rejects missing artist and inconsistent result metadata", () => {
    const artistScenario = scenarios().find(({ kind }) => kind === "artist-works");
    expect(() => checkCatalogBenchmarkResult(artistScenario!, null)).toThrow("returned no artist");
    const scenario = scenarios()[0];
    const result = songResult(scenario);
    result.pagination.totalPages += 1;
    expect(() => checkCatalogBenchmarkResult(scenario, result)).toThrow("inconsistent totals");
  });
});
