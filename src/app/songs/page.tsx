import Link from "next/link";
import { formatDate, formatDuration } from "@/lib/songs/format";
import {
  parseSongListQuery,
  type SongListQuery,
  type SongListSearchParams,
} from "@/lib/songs/list-query";
import { listSongs } from "@/lib/songs/repository";

export default async function SongsPage({
  searchParams,
}: {
  searchParams: Promise<SongListSearchParams>;
}) {
  const parsed = parseSongListQuery(await searchParams);

  if (!parsed.success) {
    return <InvalidQuery />;
  }

  const result = await listSongs(parsed.data);
  const pages = nearbyPages(result.pagination.page, result.pagination.totalPages);

  return (
    <main className="min-h-screen bg-[#0D1117] px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <Link className="text-sm text-violet-300 hover:text-violet-200" href="/">
          VocalHub
        </Link>

        <header className="mt-10">
          <p className="text-sm uppercase tracking-[0.25em] text-violet-300">
            Song Library
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">
            浏览歌曲
          </h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            搜索本地已同步的标题、别名、作者署名和标签。页面请求不会直连 VocaDB。
          </p>
        </header>

        <form
          className="mt-10 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          method="get"
        >
          <div>
            <label className="text-sm font-medium text-slate-200" htmlFor="q">
              关键词
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
              defaultValue={parsed.data.q ?? ""}
              id="q"
              maxLength={100}
              name="q"
              placeholder="歌曲、别名、作者或标签"
              type="search"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-200" htmlFor="sort">
              排序
            </label>
            <select
              className="mt-2 block rounded-xl border border-white/10 bg-[#161B22] px-4 py-3 text-white outline-none focus:border-violet-400"
              defaultValue={parsed.data.sort}
              id="sort"
              name="sort"
            >
              <option value="latest">最新发布</option>
              <option value="popular">最多收藏</option>
            </select>
          </div>
          <button
            className="self-end rounded-xl bg-violet-500 px-6 py-3 font-medium text-white hover:bg-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
            type="submit"
          >
            搜索
          </button>
        </form>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <p>
            {parsed.data.q
              ? `“${parsed.data.q}” 找到 ${result.pagination.totalItems} 首歌曲`
              : `共 ${result.pagination.totalItems} 首已同步歌曲`}
          </p>
          {parsed.data.q && (
            <Link className="text-violet-300 hover:text-violet-200" href="/songs">
              清除搜索
            </Link>
          )}
        </div>

        {result.items.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {result.items.map((song) => {
              const alternateTitle = song.names.find(
                (name) => name.value !== song.title,
              );

              return (
                <article
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition hover:border-violet-400/50"
                  key={song.id}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {song.songType}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    <Link
                      className="hover:text-violet-200"
                      href={`/songs/${song.id}`}
                    >
                      {song.title}
                    </Link>
                  </h2>
                  {alternateTitle && (
                    <p className="mt-1 text-sm text-slate-400">
                      {alternateTitle.value}
                    </p>
                  )}
                  <p className="mt-3 text-slate-300">{song.artistString}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                    <span>{formatDate(song.publishDate)}</span>
                    <span>{formatDuration(song.durationSeconds)}</span>
                    <span>{song.favoritedTimes} 次收藏</span>
                  </div>
                  {song.tags.length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {song.tags.slice(0, 4).map((tag) => (
                        <span
                          className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-200"
                          key={tag.id}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : result.pagination.totalItems > 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold">这一页没有歌曲</h2>
            <p className="mt-3 text-slate-400">页码超过当前结果范围。</p>
            <Link
              className="mt-6 inline-block text-violet-300 hover:text-violet-200"
              href={buildPageHref(parsed.data, 1)}
            >
              返回第一页
            </Link>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold">
              {parsed.data.q ? "没有匹配的歌曲" : "还没有已同步歌曲"}
            </h2>
            <p className="mt-3 text-slate-400">
              {parsed.data.q
                ? "尝试更短的标题、作者名或标签。"
                : "先运行 VocaDB 同步 worker，再返回这里浏览。"}
            </p>
          </div>
        )}

        {result.pagination.totalPages > 1 && (
          <nav
            aria-label="歌曲分页"
            className="mt-10 flex flex-wrap items-center justify-center gap-2"
          >
            {result.pagination.page > 1 && (
              <PageLink label="上一页" page={result.pagination.page - 1} query={parsed.data} />
            )}
            {pages.map((page) => (
              <PageLink
                current={page === result.pagination.page}
                key={page}
                label={String(page)}
                page={page}
                query={parsed.data}
              />
            ))}
            {result.pagination.page < result.pagination.totalPages && (
              <PageLink label="下一页" page={result.pagination.page + 1} query={parsed.data} />
            )}
          </nav>
        )}
      </div>
    </main>
  );
}

function InvalidQuery() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0D1117] px-6 text-white">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-violet-300">400</p>
        <h1 className="mt-4 text-4xl font-bold">歌曲列表参数无效</h1>
        <Link className="mt-8 inline-block text-violet-300 hover:text-violet-200" href="/songs">
          返回歌曲列表
        </Link>
      </div>
    </main>
  );
}

function PageLink({
  current = false,
  label,
  page,
  query,
}: {
  current?: boolean;
  label: string;
  page: number;
  query: SongListQuery;
}) {
  const href = buildPageHref(query, page);

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`rounded-lg border px-3 py-2 text-sm ${
        current
          ? "border-violet-400 bg-violet-500/20 text-violet-100"
          : "border-white/10 text-slate-300 hover:border-violet-400/50"
      }`}
      href={href}
    >
      {label}
    </Link>
  );
}

function buildPageHref(query: SongListQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort !== "latest") params.set("sort", query.sort);
  if (query.pageSize !== 24) params.set("pageSize", String(query.pageSize));
  if (page !== 1) params.set("page", String(page));
  const value = params.toString();
  return value ? `/songs?${value}` : "/songs";
}

function nearbyPages(current: number, total: number): number[] {
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
