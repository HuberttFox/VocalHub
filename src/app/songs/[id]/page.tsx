import { notFound } from "next/navigation";
import Link from "next/link";
import { getSongDetailById, isUuid } from "@/lib/songs/repository";

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export default async function SongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isUuid(id)) {
    notFound();
  }

  const song = await getSongDetailById(id);

  if (!song) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#0D1117] px-6 py-12 text-white">
      <article className="mx-auto max-w-5xl">
        <Link className="text-sm text-violet-300 hover:text-violet-200" href="/">
          VocalHub
        </Link>

        <header className="mt-10 border-b border-white/10 pb-10">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">
            {song.songType}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">
            {song.title}
          </h1>
          <p className="mt-4 text-xl text-slate-300">{song.artistString}</p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-400">
            <span>{formatDate(song.publishDate)}</span>
            <span>{formatDuration(song.durationSeconds)}</span>
            <span>{song.favoritedTimes} 次收藏</span>
          </div>
        </header>

        {song.names.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">多语言标题</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {song.names.map((name, index) => (
                <div className="rounded-xl bg-white/[0.04] p-4" key={`${name.language}-${index}`}>
                  <dt className="text-xs uppercase text-slate-500">{name.language}</dt>
                  <dd className="mt-1 text-slate-200">{name.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {song.credits.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">创作者与声库角色</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {song.credits.map((credit, index) => (
                <div className="rounded-xl border border-white/10 p-4" key={`${credit.name}-${index}`}>
                  <p className="font-medium">{credit.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {credit.effectiveRoles.join(" · ") || credit.categories.join(" · ") || "未分类"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {song.tags.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">标签</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {song.tags.map((tag) => (
                <span className="rounded-full bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200" key={tag.id}>
                  {tag.name}
                </span>
              ))}
            </div>
          </section>
        )}

        {song.pvs.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold">播放入口</h2>
            <div className="mt-4 grid gap-3">
              {song.pvs.map((pv) => (
                <a
                  className="flex items-center justify-between rounded-xl border border-white/10 p-4 hover:border-violet-400/50"
                  href={pv.url}
                  key={pv.id}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span>{pv.name || pv.service}</span>
                  <span className="text-sm text-slate-400">{pv.service}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-14 border-t border-white/10 pt-6 text-sm text-slate-400">
          数据来源：
          <a
            className="ml-1 text-violet-300 hover:text-violet-200"
            href={song.source.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            VocaDB #{song.vocadbId}
          </a>
          {song.source.lastSyncedAt && (
            <span className="ml-3">同步于 {formatDate(song.source.lastSyncedAt)}</span>
          )}
        </footer>
      </article>
    </main>
  );
}
