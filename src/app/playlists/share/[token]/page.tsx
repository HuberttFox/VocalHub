import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { SongCard } from "@/components/song-card";
import { getPublicPlaylist } from "@/lib/playlists/repository";
import { getViewer } from "@/lib/auth/session";
import { reportPlaylistAction } from "@/lib/playlists/actions";

export const metadata: Metadata = { title: "公开歌单" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SharedPlaylistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const playlist = await getPublicPlaylist(token);
  if (!playlist) notFound();

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <p className="eyebrow">Shared playlist</p>
        <h1 className="mt-4 text-5xl font-bold">{playlist.name}</h1>
        {playlist.description && <p className="mt-4 text-[var(--text-secondary)]">{playlist.description}</p>}
        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {playlist.entries.map((entry, index) => (
            <div key={entry.songId}>
              {entry.song ? (
                <SongCard context={`第 ${index + 1} 首`} song={entry.song} />
              ) : (
                <section className="surface p-6">
                  <p className="eyebrow">Unavailable</p>
                  <h2 className="mt-3 text-xl font-semibold">歌曲暂不可用</h2>
                </section>
              )}
            </div>
          ))}
        </div>
        {playlist.entries.length === 0 && (
          <p className="state-panel mt-10 text-[var(--text-secondary)]">此歌单暂时没有歌曲。</p>
        )}
        {await getViewer() ? (
          <section className="surface mt-10 p-6">
            <h2 className="text-xl font-semibold">报告公开歌单</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">报告不会公开显示。请仅提交与此歌单相关的反馈。</p>
            <form action={reportPlaylistAction} className="mt-4 grid gap-3">
              <input name="playlistId" type="hidden" value={playlist.id} />
              <input name="shareToken" type="hidden" value={token} />
              <select className="field" defaultValue="OTHER" name="reason">
                <option value="ILLEGAL">违法内容</option>
                <option value="ABUSIVE">骚扰或仇恨</option>
                <option value="PERSONAL_DATA">个人信息</option>
                <option value="SPAM">垃圾内容</option>
                <option value="OTHER">其他</option>
              </select>
              <textarea className="field min-h-24" maxLength={1000} name="note" placeholder="补充说明（可选）" />
              <button className="button-secondary" type="submit">提交报告</button>
            </form>
          </section>
        ) : (
          <p className="mt-10 text-sm text-[var(--text-muted)]"><Link href={`/signin?callbackUrl=${encodeURIComponent(`/playlists/share/${token}`)}`}>登录</Link> 后可报告此歌单。</p>
        )}
      </PageContainer>
    </main>
  );
}
