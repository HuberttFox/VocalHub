import type { Metadata } from "next";
import Link from "next/link";
import { Children, type ReactNode } from "react";
import { ArtistCard } from "@/components/artist-card";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageIntro } from "@/components/page-intro";
import { SongCard } from "@/components/song-card";
import { TagCard } from "@/components/tag-card";
import {
  parseSearchQuery,
  SEARCH_MAX_QUERY_LENGTH,
  type SearchParams,
} from "@/lib/search/query";
import { searchCatalog } from "@/lib/search/repository";

export const metadata: Metadata = {
  title: "全站搜索",
  description: "搜索本地 PostgreSQL 快照中的歌曲、作者和标签",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const parsed = parseSearchQuery(await searchParams);
  if (!parsed.success) {
    return (
      <main id="main-content">
        <PageContainer className="py-20">
          <ErrorState
            code="400"
            title="搜索参数无效"
            description={`请提供一个不超过 ${SEARCH_MAX_QUERY_LENGTH} 个字符的关键词。`}
            action={<Link className="button-secondary" href="/search">返回全站搜索</Link>}
          />
        </PageContainer>
      </main>
    );
  }

  const query = parsed.data.q;
  if (!query) {
    return <SearchLayout />;
  }

  const result = await searchCatalog(query);

  return <SearchLayout query={query} result={result} />;
}

function SearchLayout({
  query,
  result,
}: {
  query?: string;
  result?: Awaited<ReturnType<typeof searchCatalog>>;
}) {
  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <PageIntro
          eyebrow="Catalog search"
          title="全站搜索"
          description="一次搜索本地 PostgreSQL 快照中的歌曲、作者和标签，不在请求期间访问 VocaDB。"
        />
        <SearchForm query={query} />

        {result && query ? (
          <div className="mt-12 space-y-12">
            <ResultSection
              title="歌曲"
              count={`${result.songs.totalItems} 首`}
              emptyTitle="没有匹配的歌曲"
              emptyDescription="尝试更短的标题、作者名或标签。"
              viewAllHref={result.songs.hasMore ? searchViewAllHref("/songs", query) : undefined}
            >
              {result.songs.items.map((song) => <SongCard key={song.id} song={song} />)}
            </ResultSection>
            <ResultSection
              title="作者"
              count={`${result.artists.totalItems} 位`}
              emptyTitle="没有匹配的作者"
              emptyDescription="尝试更短的作者名或别名。"
              viewAllHref={result.artists.hasMore ? searchViewAllHref("/artists", query) : undefined}
            >
              {result.artists.items.map((artist) => <ArtistCard artist={artist} key={artist.id} />)}
            </ResultSection>
            <ResultSection
              title="标签"
              count={`${result.tags.totalItems} 个`}
              emptyTitle="没有匹配的标签"
              emptyDescription="尝试更短的标签名或精确别名。"
              viewAllHref={result.tags.hasMore ? searchViewAllHref("/tags", query) : undefined}
            >
              {result.tags.items.map((tag) => <TagCard tag={tag} key={tag.id} />)}
            </ResultSection>
          </div>
        ) : (
          <EmptyState
            eyebrow="Start searching"
            title="输入关键词开始搜索"
            description="可按歌曲标题、作者名称或标签查找本地目录内容。"
          />
        )}
      </PageContainer>
    </main>
  );
}

function SearchForm({ query }: { query?: string }) {
  return (
    <form action="/search" className="surface mt-10 flex flex-wrap items-end gap-4 p-5" method="get">
      <div className="min-w-0 flex-1">
        <label className="text-sm font-medium" htmlFor="search-q">关键词</label>
        <input
          className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-black/20 px-4 py-3 placeholder:text-[var(--text-muted)]"
          defaultValue={query ?? ""}
          id="search-q"
          maxLength={SEARCH_MAX_QUERY_LENGTH}
          name="q"
          placeholder="歌曲、作者或标签"
          type="search"
        />
      </div>
      <button className="button-primary" type="submit">搜索</button>
    </form>
  );
}

function ResultSection({
  title,
  count,
  emptyTitle,
  emptyDescription,
  viewAllHref,
  children,
}: {
  title: string;
  count: string;
  emptyTitle: string;
  emptyDescription: string;
  viewAllHref?: string;
  children: ReactNode;
}) {
  const hasItems = Children.count(children) > 0;
  return (
    <section aria-labelledby={`search-${title}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Search results</p>
          <h2 className="mt-2 text-2xl font-semibold" id={`search-${title}`}>{title}</h2>
        </div>
        <p className="text-sm text-[var(--text-muted)]">共 {count}</p>
      </div>
      {hasItems && <div className="mt-6 grid gap-4 md:grid-cols-2">{children}</div>}
      {!hasItems && (
        <div className="surface mt-6 px-5 py-6">
          <p className="font-medium text-[var(--text-primary)]">{emptyTitle}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{emptyDescription}</p>
        </div>
      )}
      {viewAllHref && (
        <div className="mt-5 text-right">
          <Link className="button-secondary" href={viewAllHref}>查看全部{title}</Link>
        </div>
      )}
    </section>
  );
}

export function searchViewAllHref(
  destination: "/songs" | "/artists" | "/tags",
  query: string,
): string {
  const params = new URLSearchParams({ q: query });
  return `${destination}?${params.toString()}`;
}
