import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageIntro } from "@/components/page-intro";
import { Pagination } from "@/components/pagination";
import { SongCard } from "@/components/song-card";
import {
  parseSongListQuery,
  type SongListQuery,
  type SongListSearchParams,
} from "@/lib/songs/list-query";
import { listSongs } from "@/lib/songs/repository";

export const metadata: Metadata = { title: "歌曲目录", description: "浏览和搜索本地已同步的术曲资料" };

export default async function SongsPage({ searchParams }: { searchParams: Promise<SongListSearchParams> }) {
  const parsed = parseSongListQuery(await searchParams);
  if (!parsed.success) {
    return <main id="main-content"><PageContainer className="py-20"><ErrorState code="400" title="歌曲列表参数无效" description="请检查页码、每页数量和排序参数。" action={<Link className="button-secondary" href="/songs">返回歌曲目录</Link>} /></PageContainer></main>;
  }

  const result = await listSongs(parsed.data);
  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <PageIntro eyebrow="Song library" title="歌曲目录" description="按标题、别名、作者署名和标签搜索本地已同步歌曲。所有请求只读取 PostgreSQL。" />
        <SearchForm query={parsed.data} />
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
          <p>{parsed.data.q ? `“${parsed.data.q}” 找到 ${result.pagination.totalItems} 首歌曲` : `共 ${result.pagination.totalItems} 首已同步歌曲`}</p>
          {parsed.data.q && <Link className="text-[var(--accent-soft)] hover:text-white" href="/songs">清除搜索</Link>}
        </div>

        {result.items.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">{result.items.map((song) => <SongCard key={song.id} song={song} />)}</div>
        ) : result.pagination.totalItems > 0 ? (
          <EmptyState eyebrow="Page unavailable" title="这一页没有歌曲" description="页码超过当前结果范围。" href={songPageHref(parsed.data, 1)} action="返回第一页" />
        ) : (
          <EmptyState eyebrow="No results" title={parsed.data.q ? "没有匹配的歌曲" : "还没有已同步歌曲"} description={parsed.data.q ? "尝试更短的标题、作者名或标签。" : "先运行 VocaDB 同步 worker，再返回这里浏览。"} href={parsed.data.q ? "/songs" : undefined} action={parsed.data.q ? "清除搜索" : undefined} />
        )}
        <Pagination current={result.pagination.page} total={result.pagination.totalPages} label="歌曲分页" hrefForPage={(page) => songPageHref(parsed.data, page)} />
      </PageContainer>
    </main>
  );
}

function SearchForm({ query }: { query: SongListQuery }) {
  return (
    <form className="surface mt-10 grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto]" method="get">
      <div><label className="text-sm font-medium" htmlFor="q">关键词</label><input className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-black/20 px-4 py-3 placeholder:text-[var(--text-muted)]" defaultValue={query.q ?? ""} id="q" maxLength={100} name="q" placeholder="歌曲、别名、作者或标签" type="search" /></div>
      <div><label className="text-sm font-medium" htmlFor="sort">排序</label><select className="mt-2 block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--canvas-soft)] px-4 py-3" defaultValue={query.sort} id="sort" name="sort"><option value="latest">最新发布</option><option value="popular">VocaDB 热门</option></select></div>
      <button className="button-primary self-end" type="submit">搜索</button>
    </form>
  );
}

function songPageHref(query: SongListQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort !== "latest") params.set("sort", query.sort);
  if (query.pageSize !== 24) params.set("pageSize", String(query.pageSize));
  if (page !== 1) params.set("page", String(page));
  return params.size ? `/songs?${params}` : "/songs";
}
