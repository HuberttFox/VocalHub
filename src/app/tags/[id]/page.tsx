import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { Pagination } from "@/components/pagination";
import { SongCard } from "@/components/song-card";
import {
  getTagDetailById,
  listTagSongs,
} from "@/lib/tags/repository";
import {
  parseArtistWorksQuery,
  type ArtistWorksQuery,
  type ArtistWorksSearchParams,
} from "@/lib/artists/works-query";
import { isUuid } from "@/lib/catalog/id";

const loadTag = cache(getTagDetailById);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tag = isUuid(id) ? await loadTag(id) : null;

  return tag
    ? {
        title: tag.name,
        description: `${tag.publicSongCount} 首本地公开歌曲`,
      }
    : { title: "标签不存在" };
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ArtistWorksSearchParams>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const query = parseArtistWorksQuery(await searchParams);
  if (!query.success) {
    return (
      <main id="main-content">
        <PageContainer className="py-20">
          <ErrorState
            code="400"
            title="歌曲列表参数无效"
            description="请检查页码、每页数量和排序参数。"
            action={<Link className="button-secondary" href={`/tags/${id}`}>返回标签页</Link>}
          />
        </PageContainer>
      </main>
    );
  }

  const [tag, songs] = await Promise.all([
    loadTag(id),
    listTagSongs(id, query.data),
  ]);
  if (!tag || !songs) notFound();

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <nav aria-label="面包屑" className="text-sm text-[var(--text-muted)]">
          <Link className="hover:text-white" href="/tags">标签目录</Link>
          <span aria-hidden="true"> / </span>
          <span>{tag.name}</span>
        </nav>
        <header className="mt-10 border-b border-[var(--border-subtle)] pb-12">
          <p className="eyebrow">Tag record</p>
          <h1 className="mt-4 text-5xl font-bold tracking-[-0.055em] sm:text-7xl">{tag.name}</h1>
          {tag.additionalNames.length > 0 && (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              {tag.additionalNames.join(" · ")}
            </p>
          )}
          <p className="mt-6 text-lg text-[var(--text-secondary)]">
            {tag.publicSongCount} 首公开歌曲
          </p>
        </header>

        <section className="pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold">关联歌曲</h2>
              <p className="mt-2 text-[var(--text-secondary)]">仅展示当前本地可公开访问的关联歌曲。</p>
            </div>
            <SortForm pageSize={query.data.pageSize} sort={query.data.sort} />
          </div>
          {songs.items.length > 0 ? (
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              {songs.items.map((song) => <SongCard key={song.id} song={song} />)}
            </div>
          ) : songs.pagination.totalItems > 0 ? (
            <EmptyState
              eyebrow="Page unavailable"
              title="这一页没有歌曲"
              description="页码超过当前歌曲范围。"
              href={tagSongsPageHref(id, query.data, 1)}
              action="返回第一页"
            />
          ) : (
            <EmptyState
              title="暂无公开歌曲"
              description="当前没有可公开展示的本地关联歌曲。"
            />
          )}
          <Pagination
            current={songs.pagination.page}
            total={songs.pagination.totalPages}
            label="标签歌曲分页"
            hrefForPage={(page) => tagSongsPageHref(id, query.data, page)}
          />
        </section>
      </PageContainer>
    </main>
  );
}

function SortForm({
  pageSize,
  sort,
}: Pick<ArtistWorksQuery, "pageSize" | "sort">) {
  return (
    <form className="flex items-end gap-3" method="get">
      <input name="pageSize" type="hidden" value={pageSize} />
      <div>
        <label className="text-sm text-[var(--text-secondary)]" htmlFor="sort">歌曲排序</label>
        <select className="mt-2 block rounded-xl border border-[var(--border-subtle)] bg-[var(--canvas-soft)] px-4 py-3" defaultValue={sort} id="sort" name="sort">
          <option value="latest">最新发布</option>
          <option value="popular">VocaDB 热门</option>
        </select>
      </div>
      <button className="button-secondary" type="submit">应用</button>
    </form>
  );
}

export function tagSongsPageHref(
  id: string,
  query: ArtistWorksQuery,
  page: number,
): string {
  const params = new URLSearchParams();
  if (query.sort !== "latest") params.set("sort", query.sort);
  if (query.pageSize !== 24) params.set("pageSize", String(query.pageSize));
  if (page !== 1) params.set("page", String(page));
  return params.size ? `/tags/${id}?${params}` : `/tags/${id}`;
}
