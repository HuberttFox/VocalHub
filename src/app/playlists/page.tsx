import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { requireViewer } from "@/lib/auth/session";
import { createPlaylistAction, deletePlaylistAction } from "@/lib/playlists/actions";
import { listPlaylists } from "@/lib/playlists/repository";

export const metadata: Metadata = { title: "我的歌单" };

export default async function PlaylistsPage() {
  const viewer = await requireViewer("/playlists");
  const playlists = await listPlaylists(viewer.id);

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <p className="eyebrow">Library</p>
        <h1 className="mt-4 text-5xl font-bold">我的歌单</h1>
        <p className="mt-4 text-[var(--text-secondary)]">歌单默认私有，仅登录账号可访问。</p>
        <form action={createPlaylistAction} className="surface mt-10 grid gap-4 p-6 sm:grid-cols-2">
          <label>
            <span className="block text-sm text-[var(--text-secondary)]">名称</span>
            <input className="field mt-2" maxLength={100} name="name" required />
          </label>
          <label>
            <span className="block text-sm text-[var(--text-secondary)]">说明（可选）</span>
            <input className="field mt-2" maxLength={500} name="description" />
          </label>
          <div className="sm:col-span-2">
            <button className="button-primary" type="submit">创建歌单</button>
          </div>
        </form>
        {playlists.length === 0 ? (
          <div className="mt-10">
            <EmptyState description="创建歌单后，可在歌曲详情页加入歌曲。" title="还没有歌单" />
          </div>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {playlists.map((playlist) => (
              <article className="surface p-6" key={playlist.id}>
                <h2 className="text-2xl font-semibold">
                  <Link className="hover:text-[var(--accent-soft)]" href={`/playlists/${playlist.id}`}>
                    {playlist.name}
                  </Link>
                </h2>
                {playlist.description && <p className="mt-2 text-[var(--text-secondary)]">{playlist.description}</p>}
                <p className="mt-4 text-sm text-[var(--text-muted)]">{playlist.itemCount} 首歌曲</p>
                <form action={deletePlaylistAction} className="mt-5">
                  <input name="playlistId" type="hidden" value={playlist.id} />
                  <button className="button-secondary" type="submit">删除歌单</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </PageContainer>
    </main>
  );
}
