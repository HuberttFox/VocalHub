import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { SongMeta } from "@/components/song-meta";
import { TagList } from "@/components/tag-list";
import { formatDate } from "@/lib/songs/format";
import { getSongDetailById, isUuid } from "@/lib/songs/repository";

const loadSong = cache(getSongDetailById);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const song = isUuid(id) ? await loadSong(id) : null;
  return song ? { title: song.title, description: `${song.artistString} · ${song.songType}` } : { title: "歌曲未找到" };
}

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const song = await loadSong(id);
  if (!song) notFound();
  const names = song.names.filter((name) => name.value !== song.title);

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <nav aria-label="面包屑" className="text-sm text-[var(--text-muted)]"><Link className="hover:text-white" href="/songs">歌曲目录</Link><span aria-hidden="true"> / </span><span>{song.title}</span></nav>
        <article>
          <header className="mt-10 grid gap-8 border-b border-[var(--border-subtle)] pb-12 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div><p className="eyebrow">{song.songType}</p><h1 className="mt-4 text-5xl font-bold tracking-[-0.055em] sm:text-7xl">{song.title}</h1><p className="mt-5 text-xl text-[var(--text-secondary)]">{song.artistString}</p><SongMeta publishDate={song.publishDate} durationSeconds={song.durationSeconds} favoritedTimes={song.favoritedTimes} /></div>
            <aside className="surface flex min-h-48 items-center justify-center p-8" aria-label="歌曲资料占位"><div className="text-center"><span className="text-6xl text-[var(--accent-soft)]" aria-hidden="true">♪</span><p className="mt-4 text-sm text-[var(--text-muted)]">封面展示等待媒体授权策略确认</p></div></aside>
          </header>

          <div className="grid gap-12 py-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-12">
              {names.length > 0 && <section><h2 className="text-2xl font-semibold">多语言标题</h2><dl className="mt-5 grid gap-3 sm:grid-cols-2">{names.map((name, index) => <div className="surface p-4" key={`${name.language}-${index}`}><dt className="eyebrow text-[0.65rem]">{name.language}</dt><dd className="mt-2 text-[var(--text-secondary)]">{name.value}</dd></div>)}</dl></section>}
              {song.credits.length > 0 && <section><h2 className="text-2xl font-semibold">创作者与声库角色</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{song.credits.map((credit, index) => <div className="surface p-5" key={`${credit.name}-${index}`}><p className="font-medium">{credit.artist ? <Link className="text-[var(--accent-soft)] hover:text-white" href={`/artists/${credit.artist.id}`}>{credit.name}</Link> : credit.name}</p><p className="mt-2 text-sm text-[var(--text-muted)]">{credit.effectiveRoles.join(" · ") || credit.categories.join(" · ") || "未分类"}{credit.isSupport ? " · 支援" : ""}</p></div>)}</div></section>}
              {song.pvs.length > 0 && <section><h2 className="text-2xl font-semibold">播放入口</h2><div className="mt-5 grid gap-3">{song.pvs.map((pv) => <a className="surface flex min-h-16 items-center justify-between gap-4 p-4 hover:border-[var(--border-strong)]" href={pv.url} key={pv.id} rel="noopener noreferrer" target="_blank"><span>{pv.name || pv.service}</span><span className="text-sm text-[var(--text-muted)]">{pv.service} · 外部链接 ↗</span></a>)}</div></section>}
            </div>
            <aside><section><h2 className="text-lg font-semibold">标签</h2><TagList tags={song.tags} /></section><section className="surface mt-8 p-5 text-sm text-[var(--text-secondary)]"><p className="eyebrow">Source</p><p className="mt-3">资料来自 <a className="text-[var(--accent-soft)] hover:text-white" href={song.source.url} rel="noopener noreferrer" target="_blank">VocaDB #{song.vocadbId} ↗</a></p>{song.source.lastSyncedAt && <p className="mt-2 text-[var(--text-muted)]">同步于 {formatDate(song.source.lastSyncedAt)}</p>}</section></aside>
          </div>
        </article>
      </PageContainer>
    </main>
  );
}
