import Link from "next/link";
import { PageContainer } from "@/components/page-container";
import { SongCard } from "@/components/song-card";
import { listSongs } from "@/lib/songs/repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [latest, popular] = await Promise.all([
    listSongs({ page: 1, pageSize: 4, sort: "latest" }),
    listSongs({ page: 1, pageSize: 4, sort: "popular" }),
  ]);

  return (
    <main id="main-content">
      <PageContainer className="py-16 sm:py-24">
        <section className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <p className="eyebrow">Vocal synthesis catalog</p>
            <h1 className="mt-5 max-w-4xl text-5xl font-bold tracking-[-0.055em] sm:text-7xl lg:text-8xl">
              在歌声与创作者之间，继续发现。
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">
              VocalHub 将 VocaDB 歌曲资料同步到本地 PostgreSQL，为中文用户提供稳定的歌曲浏览、搜索和作品关系入口。
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link className="button-primary" href="/songs">进入歌曲目录</Link>
              <a className="button-secondary" href="https://vocadb.net" rel="noopener noreferrer" target="_blank">了解数据来源 ↗</a>
            </div>
          </div>
          <aside className="surface p-6">
            <p className="eyebrow">Local-first</p>
            <p className="mt-4 text-xl font-semibold">浏览请求不直连上游</p>
            <p className="mt-3 leading-7 text-[var(--text-secondary)]">同步 worker 负责校验和清洗；页面与站内 API 只读本地快照。VocaDB 暂时不可用时，已同步资料仍可浏览。</p>
          </aside>
        </section>

        {latest.items.length > 0 ? (
          <>
            <CatalogSection title="最近发布" description="按歌曲发布时间查看本地目录中的新作品。" songs={latest.items} />
            <CatalogSection title="VocaDB 热门" description="按上游收藏与评分信号排序，不代表 VocalHub 用户行为。" songs={popular.items} />
          </>
        ) : (
          <section className="state-panel mt-20">
            <p className="eyebrow">Catalog empty</p>
            <h2 className="mt-3 text-3xl font-semibold">本地目录还没有歌曲</h2>
            <p className="mt-3 text-[var(--text-secondary)]">运行 <code className="rounded bg-white/10 px-2 py-1">npm run sync:vocadb</code> 同步 seed 歌曲。</p>
          </section>
        )}
      </PageContainer>
    </main>
  );
}

function CatalogSection({ title, description, songs }: { title: string; description: string; songs: Awaited<ReturnType<typeof listSongs>>["items"] }) {
  return (
    <section className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h2><p className="mt-2 text-[var(--text-secondary)]">{description}</p></div>
        <Link className="text-sm font-medium text-[var(--accent-soft)] hover:text-white" href="/songs">查看全部 →</Link>
      </div>
      <div className="mt-7 grid gap-4 md:grid-cols-2">{songs.map((song) => <SongCard key={song.id} song={song} />)}</div>
    </section>
  );
}
