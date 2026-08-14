# Artist and Tag Browsable Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public Artist and Tag indexes, literal search, Tag detail, and paginated Tag songs while preserving existing Song and Artist-detail contracts.

**Architecture:** Artist and Tag list queries use parameterized PostgreSQL candidate CTEs inside `RepeatableRead` transactions. Each domain exposes a public transaction-owning wrapper and a transaction primitive for Stage B composition. Prisma visibility predicates remain the reference implementation; integration tests prove raw SQL returns the same entities and counts.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript strict mode, Prisma 7.9.1, PostgreSQL 17, Zod 4, Vitest 4.

## Global Constraints

- Stage A only: do not add `/search`, `/api/search`, grouped previews, global-search navigation, benchmark scenarios, `pg_trgm`, new production indexes, or migrations.
- Keep `/songs`, `GET /api/songs`, `/artists/{id}`, and `GET /api/artists/{id}` contracts unchanged.
- Public Song visibility must match `PUBLIC_SONG_WHERE`: `sourceDeleted = false`, `lastSyncedAt IS NOT NULL`, and `syncStatus IN (SYNCED, FAILED)`.
- Public Artist visibility must match `PUBLIC_ARTIST_WHERE`, including `mergedToVocaDbId = null` and at least one public Song.
- Public Tag visibility means at least one related Song satisfies `PUBLIC_SONG_WHERE`; never use `Tag.lastSyncedAt` as public visibility.
- Scalar names use escaped, case-insensitive substring matching. `%`, `_`, and `\` are literal characters.
- `Artist.additionalNames` and `Tag.additionalNames` use exact, case-sensitive array membership.
- Artist search fields: `Artist.name`, `Artist.defaultName`, `ArtistName.value`, and `Artist.additionalNames`. Do not search `summaryAdditionalNames`.
- Artist display name is `Artist.name`. Aliases are ordered `ArtistName` values followed by `additionalNames`, trimmed, non-empty, exact case-sensitive first occurrence, excluding the display name.
- Tag aliases retain upstream array order, are trimmed, omit blanks, and retain the first exact case-sensitive occurrence.
- Artist and Tag ordering is `publicSongCount DESC`, then `lower(name) COLLATE "C" ASC`, then local UUID ascending.
- Artist and Tag candidate relations must contain one row per entity UUID before counting and paging.
- Artist and Tag `publicSongCount` is `COUNT(DISTINCT songId)` over public Songs.
- List parameters: trimmed `q` of at most 100 characters, `page` default 1/max 10,000, `pageSize` default 24/max 50; duplicate known parameters are invalid; unknown parameters are ignored.
- Tag API error codes are `INVALID_TAG_ID`, `TAG_NOT_FOUND`, `INVALID_QUERY`, and `INTERNAL_ERROR`; do not generalize them to `INVALID_ID` or `NOT_FOUND`.
- Raw SQL must use `tx.$queryRaw(Prisma.sql\`...\`)`; never use `$queryRawUnsafe` or concatenate user input.
- Do not add production indexes until Stage C benchmark evidence exists.
- Ignore `.beads/`, `.codex/`, `.claude/`, `.agents/`, `AGENTS.md`, and `CLAUDE.md`; never stage them in product commits.
- Node.js floor remains `>=20.19`; do not add dependencies.

---

## File Structure

### Shared catalog contracts

- Modify `src/lib/catalog/visibility.ts` — add canonical `PUBLIC_TAG_WHERE`.
- Create `src/lib/catalog/entity-list-query.ts` — shared Artist/Tag `q/page/pageSize` parser.
- Create `src/lib/catalog/literal-search.ts` — one escaped-literal helper shared by raw SQL search paths.
- Modify `src/lib/songs/search-query.ts` and `src/lib/songs/repository.ts` — import shared escaping helper without changing Song behavior.
- Create `tests/unit/entity-list-query.test.ts` — parser contract.
- Create `tests/unit/catalog-display-mappers.test.ts` — deterministic Artist/Tag alias mapping.

### Artist index/search

- Create `src/lib/artists/list-dto.ts` — list item and envelope types.
- Create `src/lib/artists/list-repository.ts` — raw candidate query, transaction primitive, wrapper, hydrate/mapping.
- Modify `src/lib/artists/repository.ts` — export/reuse Artist alias and avatar helpers rather than duplicate them.
- Create `src/app/api/artists/route.ts` — collection API.
- Create `src/components/artist-card.tsx` — reusable index card.
- Create `src/app/artists/page.tsx` — browsable/searchable Artist index.
- Create `src/app/artists/loading.tsx` and `src/app/artists/error.tsx` — route states.
- Create `tests/integration/artist-list-route.test.ts` — SQL/Prisma parity, search, ordering, pagination, API contract.

### Tag index/detail/songs

- Create `src/lib/tags/dto.ts` — list, detail, and songs DTOs.
- Create `src/lib/tags/mappers.ts` — ordered alias normalization.
- Create `src/lib/tags/repository.ts` — list transaction primitive/wrapper, public detail, and paginated public songs.
- Create `src/app/api/tags/route.ts` — collection API.
- Create `src/app/api/tags/[id]/route.ts` — detail API.
- Create `src/app/api/tags/[id]/songs/route.ts` — songs API.
- Create `src/components/tag-card.tsx` — reusable Tag list card.
- Modify `src/components/tag-list.tsx` — link existing Song tags to local Tag pages.
- Create `src/app/tags/page.tsx` — browsable/searchable Tag index.
- Create `src/app/tags/loading.tsx` and `src/app/tags/error.tsx` — index states.
- Create `src/app/tags/[id]/page.tsx` — detail and Song cards.
- Create `src/app/tags/[id]/loading.tsx`, `error.tsx`, and `not-found.tsx` — detail states.
- Create `tests/integration/tag-route.test.ts` — visibility, search, detail, songs, ordering, pagination, API errors.

### Product documentation

- Modify `README.md` — document Artist/Tag indexes, Tag routes/APIs, search semantics, and Stage A limitations.

---

### Task 1: Shared query, visibility, and literal-search contracts

**Files:**
- Create: `src/lib/catalog/entity-list-query.ts`
- Create: `src/lib/catalog/literal-search.ts`
- Modify: `src/lib/catalog/visibility.ts:1-22`
- Modify: `src/lib/songs/search-query.ts:21-137`
- Modify: `src/lib/songs/repository.ts:244-303`
- Test: `tests/unit/entity-list-query.test.ts`
- Test: `tests/unit/song-list-query.test.ts`
- Test: `tests/integration/song-list-route.test.ts`

**Interfaces:**
- Produces: `EntityListQuery`, `EntityListSearchParams`, `EntityListQueryResult`, `parseEntityListQuery(input)`.
- Produces: `escapeLikePattern(value: string): string`.
- Produces: `PUBLIC_TAG_WHERE satisfies Prisma.TagWhereInput`.
- Preserves: all existing Song search public signatures and results.

- [ ] **Step 1: Write parser tests**

Create `tests/unit/entity-list-query.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import {
  ENTITY_LIST_DEFAULT_PAGE_SIZE,
  ENTITY_LIST_MAX_PAGE,
  parseEntityListQuery,
} from "@/lib/catalog/entity-list-query";

describe("parseEntityListQuery", () => {
  it("uses browsable-index defaults", () => {
    expect(parseEntityListQuery(new URLSearchParams())).toEqual({
      success: true,
      data: { page: 1, pageSize: ENTITY_LIST_DEFAULT_PAGE_SIZE },
    });
  });

  it("trims q and accepts bounded paging", () => {
    expect(parseEntityListQuery(new URLSearchParams("q=%20Miku%20&page=2&pageSize=50"))).toEqual({
      success: true,
      data: { q: "Miku", page: 2, pageSize: 50 },
    });
  });

  it("drops blank q", () => {
    expect(parseEntityListQuery({ q: "   " })).toEqual({
      success: true,
      data: { page: 1, pageSize: 24 },
    });
  });

  it.each([
    "q=a&q=b",
    "page=0",
    "page=-1",
    "page=1.5",
    `page=${ENTITY_LIST_MAX_PAGE + 1}`,
    "pageSize=0",
    "pageSize=51",
    `q=${"x".repeat(101)}`,
  ])("rejects invalid URL input %s", (query) => {
    expect(parseEntityListQuery(new URLSearchParams(query))).toEqual({ success: false });
  });

  it("rejects Next.js array values and ignores unknown keys", () => {
    expect(parseEntityListQuery({ q: ["a", "b"] })).toEqual({ success: false });
    expect(parseEntityListQuery({ unknown: ["ignored"] })).toEqual({
      success: true,
      data: { page: 1, pageSize: 24 },
    });
  });
});
```

- [ ] **Step 2: Run parser test and confirm failure**

Run:

```bash
npm run test:unit -- tests/unit/entity-list-query.test.ts
```

Expected: FAIL because `@/lib/catalog/entity-list-query` does not exist.

- [ ] **Step 3: Implement the shared parser**

Create `src/lib/catalog/entity-list-query.ts`:

```ts
import { z } from "zod";

export const ENTITY_LIST_DEFAULT_PAGE_SIZE = 24;
export const ENTITY_LIST_MAX_PAGE_SIZE = 50;
export const ENTITY_LIST_MAX_PAGE = 10_000;
export const ENTITY_LIST_MAX_QUERY_LENGTH = 100;

const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive());

const schema = z.object({
  q: z.string().trim().max(ENTITY_LIST_MAX_QUERY_LENGTH)
    .transform((value) => value || undefined).optional(),
  page: positiveIntegerString.pipe(z.number().max(ENTITY_LIST_MAX_PAGE))
    .optional().default(1),
  pageSize: positiveIntegerString.pipe(z.number().max(ENTITY_LIST_MAX_PAGE_SIZE))
    .optional().default(ENTITY_LIST_DEFAULT_PAGE_SIZE),
});

export type EntityListQuery = z.output<typeof schema>;
export type EntityListSearchParams = Record<string, string | string[] | undefined>;
export type EntityListQueryResult =
  | { success: true; data: EntityListQuery }
  | { success: false };

export function parseEntityListQuery(
  input: URLSearchParams | EntityListSearchParams,
): EntityListQueryResult {
  const values: Record<string, string | undefined> = {};
  for (const key of ["q", "page", "pageSize"] as const) {
    if (input instanceof URLSearchParams) {
      const entries = input.getAll(key);
      if (entries.length > 1) return { success: false };
      values[key] = entries[0];
    } else {
      const value = input[key];
      if (Array.isArray(value)) return { success: false };
      values[key] = value;
    }
  }
  const result = schema.safeParse(values);
  if (!result.success) return { success: false };
  const { q, ...data } = result.data;
  return { success: true, data: q ? { ...data, q } : data };
}
```

- [ ] **Step 4: Add shared literal escaping and Tag visibility**

Create `src/lib/catalog/literal-search.ts`:

```ts
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
```

Add to `src/lib/catalog/visibility.ts`:

```ts
export const PUBLIC_TAG_WHERE = {
  songs: {
    some: { song: { is: PUBLIC_SONG_WHERE } },
  },
} satisfies Prisma.TagWhereInput;
```

Replace the two local Song `escapeLikePattern` implementations with the shared import. Do not alter SQL predicates, Prisma predicates, or result mapping.

- [ ] **Step 5: Run shared and Song regression tests**

Run:

```bash
npm run test:unit -- tests/unit/entity-list-query.test.ts tests/unit/song-list-query.test.ts
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/song-list-route.test.ts
```

Expected: all pass; existing literal `%`, `_`, `\`, alias, visibility, and broad/decomposed parity tests remain green.

- [ ] **Step 6: Commit Task 1 when execution has commit authority**

```bash
git add src/lib/catalog/entity-list-query.ts src/lib/catalog/literal-search.ts \
  src/lib/catalog/visibility.ts src/lib/songs/search-query.ts \
  src/lib/songs/repository.ts tests/unit/entity-list-query.test.ts
git commit -m "refactor(catalog): share entity query contracts"
```

Do not stage tracker/agent files.

---

### Task 2: Artist DTO mapping and transaction list query

**Files:**
- Create: `src/lib/artists/list-dto.ts`
- Create: `src/lib/artists/list-repository.ts`
- Modify: `src/lib/artists/repository.ts:88-193`
- Test: `tests/unit/catalog-display-mappers.test.ts`
- Test: `tests/integration/artist-list-route.test.ts`

**Interfaces:**
- Consumes: `EntityListQuery`, `escapeLikePattern`, `PUBLIC_ARTIST_WHERE` semantics.
- Produces: `ArtistListItemDto`, `ArtistListDto`.
- Produces: `listArtistsInTransaction(query, tx): Promise<ArtistListDto>`.
- Produces: `listArtists(query, database?): Promise<ArtistListDto>`.
- Produces reusable `mapArtistAliases(...)` and `mapArtistAvatar(...)` exports without changing Artist detail output.

- [ ] **Step 1: Add mapper unit tests**

Create `tests/unit/catalog-display-mappers.test.ts` and first cover Artist mapping:

```ts
import { describe, expect, it } from "vitest";
import { mapArtistAliases } from "@/lib/artists/repository";

describe("catalog display mappers", () => {
  it("maps artist aliases in localized-then-additional order", () => {
    expect(mapArtistAliases(
      "Primary",
      [
        { language: "Japanese", value: " 別名 " },
        { language: "English", value: "Primary" },
        { language: "Chinese", value: "別名" },
      ],
      [" Extra ", "", "Extra", "extra"],
    )).toEqual([
      { language: "Japanese", value: "別名" },
      { language: null, value: "Extra" },
      { language: null, value: "extra" },
    ]);
  });
});
```

- [ ] **Step 2: Run mapper test and confirm export failure**

Run:

```bash
npm run test:unit -- tests/unit/catalog-display-mappers.test.ts
```

Expected: FAIL because `mapArtistAliases` is not exported.

- [ ] **Step 3: Export existing Artist mappers and define list DTOs**

Export `mapArtistAliases` and `mapArtistAvatar` from `src/lib/artists/repository.ts`; do not change their logic or `ArtistDetailDto` output.

Create `src/lib/artists/list-dto.ts`:

```ts
export type ArtistListItemDto = {
  id: string;
  name: string;
  aliases: Array<{ language: string | null; value: string }>;
  avatarUrl: string | null;
  publicSongCount: number;
};

export type ArtistListDto = {
  items: ArtistListItemDto[];
  query: { q: string | null };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
```

`avatarUrl` fallback order is `pictureUrlThumb`, `pictureUrlSmallThumb`, `pictureUrlTinyThumb`, then `pictureUrlOriginal`; index cards should not fetch all renditions in the browser.

- [ ] **Step 4: Write failing Artist list integration fixtures**

Create `tests/integration/artist-list-route.test.ts`. Use the same `PrismaPg`, cleanup, `syncVocaDbSong`, and `syncVocaDbArtistDetail` setup as `artist-route.test.ts`.

Add direct repository tests before the API exists:

```ts
const result = await listArtists({ page: 1, pageSize: 24 }, db);
expect(result.pagination.totalItems).toBe(expectedPublicArtists);
expect(result.items.map(({ id }) => id)).toEqual(expectedIds);
```

Required fixture/assertion cases:

1. `SYNCED` and `FAILED` artists with public works appear.
2. `PENDING`, deleted, merged, never-synced, and artists with only hidden Songs disappear.
3. One Artist with two credits on one Song has `publicSongCount: 1`.
4. One Artist with two matching `ArtistName` rows appears once and increments `totalItems` once.
5. Name/defaultName/ArtistName use case-insensitive substring matching.
6. `additionalNames` matches exact case-sensitive member only; alias substring and wrong case do not match.
7. `%`, `_`, and `\` are literal.
8. Ordering uses public count, then `lower(name) COLLATE "C"`, then UUID.
9. Page beyond range has empty items and stable totals.
10. Raw result IDs equal `db.artist.findMany({ where: PUBLIC_ARTIST_WHERE })` for the visibility fixture.

Run:

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/artist-list-route.test.ts
```

Expected: FAIL because `listArtists` does not exist.

- [ ] **Step 5: Implement Artist candidate query**

Create `src/lib/artists/list-repository.ts` with these public interfaces:

```ts
import { Prisma } from "@/generated/prisma/client";
import type { EntityListQuery } from "@/lib/catalog/entity-list-query";

export type ArtistListTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "artist"
>;

export type ArtistListDb = {
  $transaction<T>(
    operation: (tx: ArtistListTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

export async function listArtistsInTransaction(
  query: EntityListQuery,
  tx: ArtistListTransaction,
): Promise<ArtistListDto>;

export async function listArtists(
  query: EntityListQuery,
  database: ArtistListDb = getDb(),
): Promise<ArtistListDto>;
```

Use one raw statement so an empty deep page still returns totals:

```sql
WITH "candidate" AS MATERIALIZED (
  SELECT
    artist."id",
    artist."name",
    COUNT(DISTINCT credit."songId")::integer AS "publicSongCount"
  FROM "Artist" AS artist
  JOIN "SongArtistCredit" AS credit ON credit."artistId" = artist."id"
  JOIN "Song" AS song ON song."id" = credit."songId"
  WHERE NOT artist."sourceDeleted"
    AND artist."mergedToVocaDbId" IS NULL
    AND artist."lastSyncedAt" IS NOT NULL
    AND artist."syncStatus" IN ('SYNCED', 'FAILED')
    AND NOT song."sourceDeleted"
    AND song."lastSyncedAt" IS NOT NULL
    AND song."syncStatus" IN ('SYNCED', 'FAILED')
    -- append parameterized search predicate only when q exists
  GROUP BY artist."id", artist."name"
),
"page" AS (
  SELECT
    "id",
    "publicSongCount",
    row_number() OVER (
      ORDER BY "publicSongCount" DESC,
        lower("name") COLLATE "C" ASC,
        "id" ASC
    ) AS "position"
  FROM "candidate"
  ORDER BY "publicSongCount" DESC,
    lower("name") COLLATE "C" ASC,
    "id" ASC
  OFFSET ${skip}
  LIMIT ${query.pageSize}
)
SELECT
  (SELECT COUNT(*)::integer FROM "candidate") AS "totalItems",
  COALESCE(
    (SELECT array_agg("id" ORDER BY "position") FROM "page"),
    ARRAY[]::uuid[]
  ) AS "ids",
  COALESCE(
    (SELECT array_agg("publicSongCount" ORDER BY "position") FROM "page"),
    ARRAY[]::integer[]
  ) AS "publicSongCounts";
```

Build search as a `Prisma.Sql` fragment:

```sql
AND (
  artist."name" ILIKE ${pattern} ESCAPE '\'
  OR artist."defaultName" ILIKE ${pattern} ESCAPE '\'
  OR artist."additionalNames" @> ARRAY[${query.q}]::text[]
  OR EXISTS (
    SELECT 1 FROM "ArtistName" AS alias
    WHERE alias."artistId" = artist."id"
      AND alias."value" ILIKE ${pattern} ESCAPE '\'
  )
)
```

The `EXISTS` and grouped candidate enforce one row per Artist. Hydrate IDs with `tx.artist.findMany` selecting ordered names, additional names, and avatar fields. Restore raw page order with an ID map. Attach `publicSongCounts[index]`; throw if the arrays differ in length or a hydrated ID is missing.

`listArtists` must wrap `listArtistsInTransaction` with:

```ts
return database.$transaction(
  (tx) => listArtistsInTransaction(query, tx),
  { isolationLevel: "RepeatableRead" },
);
```

- [ ] **Step 6: Run Artist unit and integration tests**

```bash
npm run test:unit -- tests/unit/catalog-display-mappers.test.ts
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/artist-list-route.test.ts tests/integration/artist-route.test.ts
```

Expected: pass; existing detail/works output remains unchanged.

- [ ] **Step 7: Commit Task 2 when authorized**

```bash
git add src/lib/artists/list-dto.ts src/lib/artists/list-repository.ts \
  src/lib/artists/repository.ts tests/unit/catalog-display-mappers.test.ts \
  tests/integration/artist-list-route.test.ts
git commit -m "feat(artists): add searchable catalog query"
```

---

### Task 3: Artist collection API and browsable page

**Files:**
- Create: `src/app/api/artists/route.ts`
- Create: `src/components/artist-card.tsx`
- Create: `src/app/artists/page.tsx`
- Create: `src/app/artists/loading.tsx`
- Create: `src/app/artists/error.tsx`
- Modify: `tests/integration/artist-list-route.test.ts`

**Interfaces:**
- Consumes: `parseEntityListQuery`, `listArtists`, `ArtistListItemDto`.
- Produces: `GET /api/artists` with `ArtistListDto` success envelope.
- Produces: `/artists` browsable/searchable Server Component.

- [ ] **Step 1: Add failing API contract tests**

Extend `artist-list-route.test.ts`:

```ts
import { GET as getArtists } from "@/app/api/artists/route";

function artistsRequest(query = "") {
  return getArtists(new Request(
    `http://localhost/api/artists${query ? `?${query}` : ""}`,
  ));
}
```

Assert:

- defaults return `{ items, query: { q: null }, pagination }`.
- `q=%20Producer%20` returns `query.q === "Producer"`.
- repeated `q`, oversized q, page 0, pageSize 51 return `400 INVALID_QUERY`.
- unknown query keys are ignored.
- response does not expose `vocadbId`, sync status/error, provider identity, or raw picture fields.

Run focused integration test; expect module-not-found failure.

- [ ] **Step 2: Implement `GET /api/artists`**

Create `src/app/api/artists/route.ts`:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/error-response";
import { parseEntityListQuery } from "@/lib/catalog/entity-list-query";
import { listArtists } from "@/lib/artists/list-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const parsed = parseEntityListQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    return errorResponse("INVALID_QUERY", "Invalid artist list query", 400);
  }
  try {
    return NextResponse.json(await listArtists(parsed.data));
  } catch (error) {
    console.error("Unable to load artists", error);
    return errorResponse("INTERNAL_ERROR", "Unable to load artists", 500);
  }
}
```

- [ ] **Step 3: Implement `ArtistCard`**

Create `src/components/artist-card.tsx`. Required rendering:

- card links to `/artists/${artist.id}`.
- `RemoteImage` uses `artist.avatarUrl` with stable square placeholder.
- render name, at most the first three aliases, and `${publicSongCount} 首公开作品`.
- no client state or request-time upstream fetch.

Signature:

```ts
export function ArtistCard({ artist }: { artist: ArtistListItemDto })
```

- [ ] **Step 4: Implement `/artists` page and route states**

Create `src/app/artists/page.tsx` following `/songs/page.tsx`:

- parse `searchParams: Promise<EntityListSearchParams>`.
- invalid input renders `ErrorState` code 400 and `/artists` reset link; do not query DB.
- GET form has only `q`, placeholder “作者名或别名”, maxLength 100.
- result summary distinguishes browse and search.
- grid renders `ArtistCard`.
- empty search, empty catalog, and page-out-of-range messages are distinct.
- `artistPageHref(query, page)` preserves q and non-default pageSize; omit page 1.
- use shared `Pagination` label “作者分页”.

Create `src/app/artists/loading.tsx` with `CatalogSkeleton` and `src/app/artists/error.tsx` with `ResettableError` title “无法加载作者目录”. Do not modify `/artists/[id]`.

- [ ] **Step 5: Run Artist surface checks**

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/artist-list-route.test.ts tests/integration/artist-route.test.ts
npm run lint
npx tsc --noEmit
npm run build:web
```

Expected: all pass; build includes `/artists` and `/api/artists`.

- [ ] **Step 6: Commit Task 3 when authorized**

```bash
git add src/app/api/artists/route.ts src/components/artist-card.tsx \
  src/app/artists/page.tsx src/app/artists/loading.tsx \
  src/app/artists/error.tsx tests/integration/artist-list-route.test.ts
git commit -m "feat(artists): add browsable index"
```

---

### Task 4: Tag DTO mapping and list/detail repository

**Files:**
- Create: `src/lib/tags/dto.ts`
- Create: `src/lib/tags/mappers.ts`
- Create: `src/lib/tags/repository.ts`
- Modify: `tests/unit/catalog-display-mappers.test.ts`
- Create: `tests/integration/tag-route.test.ts`

**Interfaces:**
- Consumes: `EntityListQuery`, `PUBLIC_TAG_WHERE`, `PUBLIC_SONG_WHERE`, `escapeLikePattern`.
- Produces: `TagListItemDto`, `TagListDto`, `TagDetailDto`, `TagSongsDto`.
- Produces: `normalizeTagAliases(values): string[]`.
- Produces: `listTagsInTransaction`, `listTags`, `getTagDetailById`, `listTagSongs`.

- [ ] **Step 1: Add Tag mapper unit test**

Extend `catalog-display-mappers.test.ts`:

```ts
import { normalizeTagAliases } from "@/lib/tags/mappers";

it("normalizes tag aliases without reordering or case folding", () => {
  expect(normalizeTagAliases([
    " synth ", "", "Synth", "synth", " synth ", "electronic",
  ])).toEqual(["synth", "Synth", "electronic"]);
});
```

Run focused unit test; expect module-not-found failure.

- [ ] **Step 2: Define Tag DTOs and mapper**

Create `src/lib/tags/dto.ts`:

```ts
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
```

Create `src/lib/tags/mappers.ts`:

```ts
export function normalizeTagAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
```

- [ ] **Step 3: Write failing Tag repository integration tests**

Create `tests/integration/tag-route.test.ts` with real PostgreSQL setup and cleanup order from `song-list-route.test.ts`.

Seed through `syncVocaDbSong` where possible, then directly create extra visibility rows for precise states. Before route imports are added, call repository functions directly.

Required list/detail cases:

1. Orphan Tag and Tag linked only to hidden Song do not appear and detail returns null.
2. Tag linked to `SYNCED` or `FAILED` Song appears.
3. Tag linked to public and hidden Songs reports only distinct public count.
4. Name uses case-insensitive literal substring; `%`, `_`, `\` stay literal.
5. `additionalNames` matches exact case-sensitive member; substring/wrong case do not match.
6. Tag aliases map in upstream order with trim/first-exact dedup.
7. Ordering and deep-page totals are stable.
8. Raw list IDs equal `db.tag.findMany({ where: PUBLIC_TAG_WHERE })` for visibility fixtures.

Run focused integration test; expect missing repository failure.

- [ ] **Step 4: Implement Tag list candidate query and transaction primitive**

Create `src/lib/tags/repository.ts` with:

```ts
export type TagListTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "tag" | "song"
>;

export type TagListDb = {
  $transaction<T>(
    operation: (tx: TagListTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

export async function listTagsInTransaction(
  query: EntityListQuery,
  tx: TagListTransaction,
): Promise<TagListDto>;

export async function listTags(
  query: EntityListQuery,
  database: TagListDb = getDb(),
): Promise<TagListDto>;
```

Use the Artist list raw-query shape, replacing candidate relation with:

```sql
SELECT
  tag."id",
  tag."name",
  COUNT(DISTINCT relation."songId")::integer AS "publicSongCount"
FROM "Tag" AS tag
JOIN "SongTag" AS relation ON relation."tagId" = tag."id"
JOIN "Song" AS song ON song."id" = relation."songId"
WHERE NOT song."sourceDeleted"
  AND song."lastSyncedAt" IS NOT NULL
  AND song."syncStatus" IN ('SYNCED', 'FAILED')
  AND (
    tag."name" ILIKE ${pattern} ESCAPE '\'
    OR tag."additionalNames" @> ARRAY[${query.q}]::text[]
  )
GROUP BY tag."id", tag."name"
```

Omit the search group when q is absent. Use the same page order, array aggregation, invariant checks, hydration order restoration, totals, and `RepeatableRead` wrapper as Artist list.

- [ ] **Step 5: Implement public Tag detail**

Add:

```ts
export async function getTagDetailById(
  id: string,
  database: TagListDb = getDb(),
): Promise<TagDetailDto | null>;
```

Behavior:

- return null if `!isUuid(id)`.
- run one `RepeatableRead` callback transaction.
- `tx.tag.findFirst({ where: { id, ...PUBLIC_TAG_WHERE } })` selects id/name/additionalNames.
- `tx.song.count({ where: { ...PUBLIC_SONG_WHERE, tags: { some: { tagId: id } } } })` supplies `publicSongCount`.
- return null when Tag is not public; never expose orphan/hidden-only Tag.

- [ ] **Step 6: Run Tag mapper and repository tests**

```bash
npm run test:unit -- tests/unit/catalog-display-mappers.test.ts
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/tag-route.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 4 when authorized**

```bash
git add src/lib/tags/dto.ts src/lib/tags/mappers.ts \
  src/lib/tags/repository.ts tests/unit/catalog-display-mappers.test.ts \
  tests/integration/tag-route.test.ts
git commit -m "feat(tags): add public catalog queries"
```

---

### Task 5: Tag songs query and entity APIs

**Files:**
- Modify: `src/lib/tags/repository.ts`
- Create: `src/app/api/tags/[id]/route.ts`
- Create: `src/app/api/tags/[id]/songs/route.ts`
- Modify: `tests/integration/tag-route.test.ts`

**Interfaces:**
- Consumes: `parseArtistWorksQuery`, `SONG_LIST_SELECT`, `buildSongListOrder`, `mapSongListItem`.
- Produces: `listTagSongs(id, query, database?): Promise<TagSongsDto | null>`.
- Produces: `GET /api/tags/{id}` and `GET /api/tags/{id}/songs`.

- [ ] **Step 1: Add failing Tag detail/song API tests**

Add route imports and helpers:

```ts
import { GET as getTag } from "@/app/api/tags/[id]/route";
import { GET as getTagSongs } from "@/app/api/tags/[id]/songs/route";
```

Assert:

- source numeric ID and malformed UUID return `400 INVALID_TAG_ID`.
- unknown, orphan, and hidden-only Tag return `404 TAG_NOT_FOUND` from both routes.
- detail returns exactly id/name/additionalNames/publicSongCount.
- songs include only public `SYNCED`/`FAILED` Songs and reuse `SongListItemDto` fields.
- latest/popular order matches existing Song ordering.
- repeated/invalid paging or sort returns `400 INVALID_QUERY`.
- out-of-range page returns 200, empty items, stable totals.

Run test; expect missing routes/listTagSongs failure.

- [ ] **Step 2: Implement `listTagSongs`**

In `src/lib/tags/repository.ts`:

```ts
export async function listTagSongs(
  id: string,
  query: ArtistWorksQuery,
  database: TagListDb = getDb(),
): Promise<TagSongsDto | null>;
```

Inside one `RepeatableRead` callback transaction, execute the operations sequentially because an interactive transaction uses one PostgreSQL connection:

```ts
const tag = await tx.tag.findFirst({
  where: { id, ...PUBLIC_TAG_WHERE },
  select: { id: true },
});
if (!tag) return null;

const where = {
  ...PUBLIC_SONG_WHERE,
  tags: { some: { tagId: id } },
} satisfies Prisma.SongWhereInput;

const totalItems = await tx.song.count({ where });
const rows = await tx.song.findMany({
  where,
  orderBy: buildSongListOrder(query.sort),
  skip: (query.page - 1) * query.pageSize,
  take: query.pageSize,
  select: SONG_LIST_SELECT,
});
```

Map rows with `mapSongListItem`. UUID failure returns null before transaction.

- [ ] **Step 3: Implement Tag detail API**

Create `src/app/api/tags/[id]/route.ts`, mirroring Artist detail route:

- validate with `isUuid` before repository call.
- malformed ID: `INVALID_TAG_ID`, 400.
- null detail: `TAG_NOT_FOUND`, 404.
- exception: log and return `INTERNAL_ERROR`, 500.
- success: `NextResponse.json(detail)`.

- [ ] **Step 4: Implement Tag songs API**

Create `src/app/api/tags/[id]/songs/route.ts`:

1. resolve `params` and validate UUID.
2. parse `new URL(request.url).searchParams` with `parseArtistWorksQuery`.
3. invalid ID/query use `INVALID_TAG_ID` / `INVALID_QUERY`.
4. null result uses `TAG_NOT_FOUND`.
5. return `TagSongsDto` without embedding Tag detail.

- [ ] **Step 5: Run focused API tests**

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/tag-route.test.ts \
  tests/integration/song-list-route.test.ts tests/integration/artist-route.test.ts
```

Expected: pass with no Song/Artist API regression.

- [ ] **Step 6: Commit Task 5 when authorized**

```bash
git add src/lib/tags/repository.ts src/app/api/tags/[id]/route.ts \
  src/app/api/tags/[id]/songs/route.ts tests/integration/tag-route.test.ts
git commit -m "feat(tags): add detail and song APIs"
```

---

### Task 6: Tag collection API and browsable index

**Files:**
- Create: `src/app/api/tags/route.ts`
- Create: `src/components/tag-card.tsx`
- Create: `src/app/tags/page.tsx`
- Create: `src/app/tags/loading.tsx`
- Create: `src/app/tags/error.tsx`
- Modify: `tests/integration/tag-route.test.ts`

**Interfaces:**
- Consumes: `parseEntityListQuery`, `listTags`, `TagListItemDto`.
- Produces: `GET /api/tags` and `/tags`.

- [ ] **Step 1: Add failing collection API tests**

Import `GET as getTags` and assert:

- default browse envelope with `query.q: null`.
- trimmed q echo.
- invalid/repeated params return `400 INVALID_QUERY`.
- hidden/orphan Tags do not affect items or totals.
- DTO contains only id/name/additionalNames/publicSongCount.

- [ ] **Step 2: Implement `GET /api/tags`**

Mirror Task 3 Artist collection route, using `parseEntityListQuery` and `listTags`. Error messages identify Tag list, while codes stay `INVALID_QUERY` and `INTERNAL_ERROR`.

- [ ] **Step 3: Implement `TagCard`**

Create `src/components/tag-card.tsx`:

```ts
export function TagCard({ tag }: { tag: TagListItemDto })
```

Render a link to `/tags/${tag.id}`, primary name, up to three normalized aliases, and `${tag.publicSongCount} 首公开歌曲`. Use existing surface/card classes; no image placeholder.

- [ ] **Step 4: Implement `/tags` page and route states**

Follow Artist index page exactly, substituting Tag labels and `TagCard`:

- title “标签目录”.
- description states only Tags with public Songs appear.
- search placeholder “标签名或精确别名”.
- separate empty catalog/search/out-of-range states.
- `tagPageHref` preserves q/pageSize and omits defaults.
- Pagination label “标签分页”.

Create loading/error files with `CatalogSkeleton` and `ResettableError`.

- [ ] **Step 5: Run Tag index validation**

```bash
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/tag-route.test.ts
npm run lint
npx tsc --noEmit
npm run build:web
```

Expected: pass; build includes `/tags` and `/api/tags`.

- [ ] **Step 6: Commit Task 6 when authorized**

```bash
git add src/app/api/tags/route.ts src/components/tag-card.tsx \
  src/app/tags/page.tsx src/app/tags/loading.tsx src/app/tags/error.tsx \
  tests/integration/tag-route.test.ts
git commit -m "feat(tags): add browsable index"
```

---

### Task 7: Tag detail page and linked Song tags

**Files:**
- Create: `src/app/tags/[id]/page.tsx`
- Create: `src/app/tags/[id]/loading.tsx`
- Create: `src/app/tags/[id]/error.tsx`
- Create: `src/app/tags/[id]/not-found.tsx`
- Modify: `src/components/tag-list.tsx:1-5`

**Interfaces:**
- Consumes: `getTagDetailById`, `listTagSongs`, `parseArtistWorksQuery`, `SongCard`.
- Produces: `/tags/{localUuid}` and links from existing Song cards/details.

- [ ] **Step 1: Make existing Tag chips navigable**

Modify `src/components/tag-list.tsx` to import `Link` and render each item as:

```tsx
<li key={tag.id}>
  <Link className="tag-chip" href={`/tags/${tag.id}`}>
    {tag.name}
  </Link>
</li>
```

Preserve existing list semantics and local UUID. Do not use VocaDB numeric IDs or URL slugs as route identity.

- [ ] **Step 2: Implement Tag detail page**

Create `src/app/tags/[id]/page.tsx`:

- `generateMetadata` loads public Tag detail and returns fallback “标签不存在” metadata when null.
- page validates UUID, parses `page/pageSize/sort` with `parseArtistWorksQuery`, and calls `notFound()` for malformed/unknown/hidden-only Tag.
- invalid list query renders 400 `ErrorState` with return link to `/tags/${id}`; do not silently choose values.
- render name, normalized aliases, and `${publicSongCount} 首公开歌曲`.
- render latest/popular GET sort control.
- render `SongCard` grid using `listTagSongs` output.
- distinguish no public Songs (defensive), out-of-range page, and normal results.
- pagination preserves sort and non-default pageSize.

Use `cache(getTagDetailById)` for metadata/page request deduplication, matching Artist detail page.

- [ ] **Step 3: Add loading/error/not-found states**

- `loading.tsx`: `CatalogSkeleton`.
- `error.tsx`: client `ResettableError` title “无法加载标签”.
- `not-found.tsx`: `ErrorState` with `/tags` return action.

- [ ] **Step 4: Build and manually verify runtime surfaces**

Start isolated PostgreSQL test DB and app:

```bash
docker compose --profile test up -d --wait postgres-test
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/tag-route.test.ts
npm run build:web
npm run dev
```

Runtime checks through browser/HTTP surface:

1. `/artists` renders public Artist cards and query form.
2. `/tags` renders only public Tags.
3. Song Tag chip opens `/tags/{localUuid}`.
4. Tag detail renders only public Songs.
5. malformed/unknown Tag page renders not-found UI.
6. `/tags/{id}?sort=popular&page=10000` renders stable out-of-range state.

Capture rendered response or screenshot during execution; do not substitute unit tests for this runtime check.

- [ ] **Step 5: Commit Task 7 when authorized**

```bash
git add src/app/tags/[id]/page.tsx src/app/tags/[id]/loading.tsx \
  src/app/tags/[id]/error.tsx src/app/tags/[id]/not-found.tsx \
  src/components/tag-list.tsx
git commit -m "feat(tags): add public detail page"
```

---

### Task 8: Documentation, full regression, and Stage A review

**Files:**
- Modify: `README.md`
- Verify: all Stage A source/test files

**Interfaces:**
- Produces: documented routes/API/search semantics and a green Stage A delivery.
- Does not produce: `/search`, `/api/search`, benchmark results, or index migration.

- [ ] **Step 1: Update README product/API documentation**

Update these sections without rewriting unrelated material:

- Current state: Artist and Tag indexes, Tag detail/public-song page.
- Not implemented: keep independent cross-entity full-site search listed until Stage B.
- Visit routes: add `/artists`, `/tags`, `/tags/{localUuid}`.
- Current API: add `GET /api/artists`, `GET /api/tags`, `GET /api/tags/{id}`, `GET /api/tags/{id}/songs`.
- Search semantics: scalar names are case-insensitive literal substring; Artist/Tag array aliases are exact case-sensitive members.
- Visibility: Tag requires at least one public Song.
- Error codes: document `INVALID_TAG_ID` and `TAG_NOT_FOUND`.
- Performance: state Stage A adds no production index; Tag reverse/trigram/array candidates remain pending Stage C evidence.

- [ ] **Step 2: Run focused tests**

```bash
npm run test:unit -- tests/unit/entity-list-query.test.ts \
  tests/unit/catalog-display-mappers.test.ts tests/unit/song-list-query.test.ts
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration -- tests/integration/artist-list-route.test.ts \
  tests/integration/artist-route.test.ts tests/integration/tag-route.test.ts \
  tests/integration/song-list-route.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run full quality gates**

```bash
npm run test:unit
TEST_DATABASE_URL=postgresql://vocalhub:vocalhub@localhost:5433/vocalhub_test \
  npm run test:integration
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: all pass. Existing integration-suite `pg` deprecation warning may remain non-fatal; any new warning or failure blocks completion.

- [ ] **Step 4: Review Stage A scope and security boundaries**

Verify in the final diff:

- no VocaDB imports under `src/app` or request-time upstream calls.
- no `/search`, `/api/search`, benchmark, extension, index, schema, or migration changes.
- no raw SQL unsafe interpolation.
- no hidden Song metadata in Tag DTOs.
- no source numeric ID used as a route ID.
- no tracker/agent files staged.
- Artist/Tag raw SQL public predicates remain equivalent to Prisma reference predicates.

Request independent code review against `docs/superpowers/specs/2026-07-29-full-site-search-design.md`, limited to Stage A.

- [ ] **Step 5: Commit documentation/final fixes when authorized**

```bash
git add README.md docs/superpowers/specs/2026-07-29-full-site-search-design.md \
  docs/superpowers/plans/2026-07-29-full-site-search-stage-a.md
git commit -m "docs(catalog): document artist and tag indexes"
```

If implementation commits already included the docs, skip this commit rather than creating an empty commit.

---

## Stage A Acceptance Checklist

- [ ] `/artists` browses and searches only public Artists.
- [ ] `/tags` browses and searches only Tags with at least one public Song.
- [ ] `/tags/{localUuid}` exposes only public Song cards.
- [ ] Artist/Tag scalar and array-alias matching obey different documented semantics.
- [ ] Candidate entity IDs and `COUNT(DISTINCT songId)` prevent duplicate totals/items.
- [ ] Raw SQL and Prisma reference visibility sets match across all lifecycle fixtures.
- [ ] Collection API envelopes and entity-specific Tag errors match the spec.
- [ ] Artist/Tag list transaction primitives are available for Stage B composition.
- [ ] No Stage B `/search` or Stage C index/benchmark work entered the diff.
- [ ] Unit, integration, TypeScript, lint, full build, runtime verification, and `git diff --check` pass.
