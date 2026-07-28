import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { Pagination } from "@/components/pagination";
import { SongCard } from "@/components/song-card";
import { requireViewer } from "@/lib/auth/session";
import { setFavoriteAction } from "@/lib/favorites/actions";
import { parseFavoriteListQuery } from "@/lib/favorites/query";
import { listFavorites } from "@/lib/favorites/repository";

export const metadata: Metadata = { title: "我的收藏" };

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer("/favorites");
  const parsed = parseFavoriteListQuery(await searchParams);
  if (!parsed.success) {
    return (
      <main id="main-content">
        <PageContainer className="py-20">
          <ErrorState
            action={<Link className="button-secondary" href="/favorites">返回我的收藏</Link>}
            code="400"
            description="请检查页码和每页数量。"
            title="收藏列表参数无效"
          />
        </PageContainer>
      </main>
    );
  }
  const query = parsed.data;
  const result = await listFavorites(viewer.id, query);

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <p className="eyebrow">Library</p>
        <h1 className="mt-4 text-5xl font-bold">我的收藏</h1>
        <p className="mt-4 text-[var(--text-secondary)]">
          收藏仅保存在 VocalHub，不会写回 VocaDB。
        </p>
        {result.items.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              action="浏览歌曲"
              description="在歌曲详情页加入你的第一首收藏。"
              href="/songs"
              title="还没有收藏"
            />
          </div>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {result.items.map((item) => item.song ? (
              <div key={item.songId}>
                <SongCard context="我的收藏" song={item.song} />
                <RemoveFavorite songId={item.songId} />
              </div>
            ) : (
              <section className="surface p-6" key={item.songId}>
                <p className="eyebrow">Unavailable</p>
                <h2 className="mt-3 text-xl font-semibold">歌曲暂不可用</h2>
                <p className="mt-2 text-sm text-[var(--text-muted)]">本地引用已保留，可从收藏中移除。</p>
                <RemoveFavorite songId={item.songId} />
              </section>
            ))}
          </div>
        )}
        <Pagination
          current={result.pagination.page}
          hrefForPage={(page) => `/favorites?page=${page}&pageSize=${query.pageSize}`}
          label="收藏分页"
          total={result.pagination.totalPages}
        />
      </PageContainer>
    </main>
  );
}

function RemoveFavorite({ songId }: { songId: string }) {
  return (
    <form action={setFavoriteAction} className="mt-3">
      <input name="songId" type="hidden" value={songId} />
      <input name="desired" type="hidden" value="false" />
      <button className="button-secondary" type="submit">移除收藏</button>
    </form>
  );
}
