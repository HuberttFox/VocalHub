import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/lib/auth/session";
import { PageContainer } from "@/components/page-container";
import { PageIntro } from "@/components/page-intro";
import { Pagination } from "@/components/pagination";
import { SongCard } from "@/components/song-card";
import { getDiscovery } from "@/lib/discover/repository";
import { parseDiscoveryQuery } from "@/lib/discover/query";

export const metadata: Metadata = { title: "发现歌曲" };

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = parseDiscoveryQuery(await searchParams);
  if (!parsed.success) {
    return <main id="main-content"><PageContainer className="py-12"><p className="state-panel">发现页参数无效。</p></PageContainer></main>;
  }
  const viewer = await getViewer();
  const discovery = await getDiscovery(viewer?.id ?? null, parsed.data);
  const title = discovery.mode === "PERSONALIZED" ? "为你推荐" : "热门发现";
  const description = discovery.mode === "PERSONALIZED"
    ? "根据你的收藏和歌单，发现更多公开歌曲。"
    : "从公开歌曲目录中发现热门作品。登录并收藏歌曲后，可获得个性化推荐。";

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <PageIntro eyebrow="Discover" title={title} description={description} />
        {discovery.freshness !== "FRESH" ? (
          <p className="state-panel mt-6">
            {discovery.freshness === "PENDING"
              ? "正在生成个性化推荐，暂时展示热门歌曲。"
              : "推荐结果正在更新，当前展示最近一次完整结果。"}
          </p>
        ) : null}
        {discovery.items.length > 0 ? (
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {discovery.items.map((song) => <SongCard key={song.id} song={song} />)}
          </div>
        ) : discovery.pagination.totalItems > 0 ? (
          <section className="state-panel mt-10">
            <h2 className="text-xl font-semibold">这一页没有歌曲</h2>
            <Link className="button-primary mt-5 inline-flex" href={`/discover?pageSize=${parsed.data.pageSize}`}>返回第一页</Link>
          </section>
        ) : (
          <section className="state-panel mt-10">
            <h2 className="text-xl font-semibold">暂时没有可推荐的歌曲</h2>
            <p className="mt-3">先浏览歌曲目录并收藏喜欢的作品。</p>
            <Link className="button-primary mt-5 inline-flex" href="/songs">浏览歌曲目录</Link>
          </section>
        )}
        <Pagination
          current={discovery.pagination.page}
          total={discovery.pagination.totalPages}
          hrefForPage={(page) => `/discover?page=${page}&pageSize=${parsed.data.pageSize}`}
          label="发现页码"
        />
      </PageContainer>
    </main>
  );
}
