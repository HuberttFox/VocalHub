import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { Pagination } from "@/components/pagination";
import { SongCard } from "@/components/song-card";
import { getArtistDetailById, listArtistWorks } from "@/lib/artists/repository";
import { parseArtistWorksQuery, type ArtistWorksQuery, type ArtistWorksSearchParams } from "@/lib/artists/works-query";
import { isUuid } from "@/lib/catalog/id";
import { formatDate } from "@/lib/songs/format";

const loadArtist = cache(getArtistDetailById);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const artist = isUuid(id) ? await loadArtist(id) : null;
  return artist ? { title: artist.name, description: `${artist.artistType} · ${artist.worksCount} 首本地公开作品` } : { title: "作者未找到" };
}

export default async function ArtistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ArtistWorksSearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = parseArtistWorksQuery(await searchParams);
  if (!query.success) return <main id="main-content"><PageContainer className="py-20"><ErrorState code="400" title="作品列表参数无效" description="请检查页码、每页数量和排序参数。" action={<Link className="button-secondary" href={`/artists/${id}`}>返回作者页</Link>} /></PageContainer></main>;
  const [artist, works] = await Promise.all([loadArtist(id), listArtistWorks(id, query.data)]);
  if (!artist || !works) notFound();

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <nav aria-label="面包屑" className="text-sm text-[var(--text-muted)]"><Link className="hover:text-white" href="/songs">歌曲目录</Link><span aria-hidden="true"> / </span><span>{artist.name}</span></nav>
        <header className="mt-10 grid gap-8 border-b border-[var(--border-subtle)] pb-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div><p className="eyebrow">{artist.artistType}</p><h1 className="mt-4 text-5xl font-bold tracking-[-0.055em] sm:text-7xl">{artist.name}</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">以下为本地已同步歌曲中明确关联到该艺人的公开作品。当前资料来自歌曲中的结构化 artist credit，不包含独立作者简介。</p></div>
          <aside className="surface p-6"><p className="eyebrow">Catalog record</p><p className="mt-3 text-4xl font-semibold">{artist.worksCount}</p><p className="mt-1 text-sm text-[var(--text-muted)]">首公开作品</p><a className="mt-6 block text-sm text-[var(--accent-soft)] hover:text-white" href={artist.source.url} rel="noopener noreferrer" target="_blank">VocaDB Artist #{artist.vocadbId} ↗</a>{artist.source.lastSyncedAt && <p className="mt-2 text-xs text-[var(--text-muted)]">同步于 {formatDate(artist.source.lastSyncedAt)}</p>}</aside>
        </header>

        <section className="pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-3xl font-semibold">关联作品</h2><p className="mt-2 text-[var(--text-secondary)]">同一歌曲中的多个角色 credit 合并为一条作品记录。</p></div><SortForm sort={query.data.sort} /></div>
          {works.items.length > 0 ? <div className="mt-7 grid gap-4 md:grid-cols-2">{works.items.map((song) => <SongCard context={creditContext(song.artistCredits)} key={song.id} song={song} />)}</div> : works.pagination.totalItems > 0 ? <EmptyState eyebrow="Page unavailable" title="这一页没有作品" description="页码超过当前作品范围。" href={artistPageHref(id, query.data, 1)} action="返回第一页" /> : <EmptyState title="暂无公开作品" description="当前没有可公开展示的本地关联歌曲。" />}
          <Pagination current={works.pagination.page} total={works.pagination.totalPages} label="作者作品分页" hrefForPage={(page) => artistPageHref(id, query.data, page)} />
        </section>
      </PageContainer>
    </main>
  );
}

function SortForm({ sort }: { sort: ArtistWorksQuery["sort"] }) { return <form className="flex items-end gap-3" method="get"><div><label className="text-sm text-[var(--text-secondary)]" htmlFor="sort">作品排序</label><select className="mt-2 block rounded-xl border border-[var(--border-subtle)] bg-[var(--canvas-soft)] px-4 py-3" defaultValue={sort} id="sort" name="sort"><option value="latest">最新发布</option><option value="popular">VocaDB 热门</option></select></div><button className="button-secondary" type="submit">应用</button></form>; }
function creditContext(credits: Array<{ effectiveRoles: string[]; categories: string[]; isSupport: boolean }>): string | undefined { const values = credits.flatMap((credit) => credit.effectiveRoles.length ? credit.effectiveRoles : credit.categories); const roles = Array.from(new Set(values)).join(" · "); const support = credits.some((credit) => credit.isSupport) ? " · 支援" : ""; return roles ? `${roles}${support}` : support.slice(3) || undefined; }
function artistPageHref(id: string, query: ArtistWorksQuery, page: number): string { const params = new URLSearchParams(); if (query.sort !== "latest") params.set("sort", query.sort); if (query.pageSize !== 24) params.set("pageSize", String(query.pageSize)); if (page !== 1) params.set("page", String(page)); return params.size ? `/artists/${id}?${params}` : `/artists/${id}`; }
