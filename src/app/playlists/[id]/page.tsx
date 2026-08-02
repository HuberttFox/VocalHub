import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { LeavePlaylistForm } from "@/components/leave-playlist-form";
import { SongCard } from "@/components/song-card";
import { requireViewer } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/id";
import {
  addPlaylistCollaboratorAction,
  leavePlaylistAction,
  movePlaylistSongAction,
  removePlaylistCollaboratorAction,
  removePlaylistSongAction,
  setPlaylistVisibilityAction,
  updatePlaylistAction,
} from "@/lib/playlists/actions";
import { getPlaylist } from "@/lib/playlists/repository";

export const metadata: Metadata = { title: "私人歌单" };

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireViewer(`/playlists/${id}`);
  const playlist = await getPlaylist(viewer.id, id);
  if (!playlist) notFound();

  return (
    <main id="main-content">
      <PageContainer className="py-12 sm:py-16">
        <Link className="text-sm text-[var(--text-muted)] hover:text-white" href="/playlists">← 我的歌单</Link>
        <h1 className="mt-5 text-5xl font-bold">{playlist.name}</h1>
        {playlist.description && <p className="mt-4 text-[var(--text-secondary)]">{playlist.description}</p>}
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          {playlist.role === "OWNER" ? "所有者" : "协作者"} · {playlist.visibility === "PUBLIC" ? "公开分享" : "私有"}
        </p>
        {playlist.role === "OWNER" && (
          <>
            <section className="surface mt-8 p-6">
              <h2 className="text-xl font-semibold">分享设置</h2>
              <form action={setPlaylistVisibilityAction} className="mt-4 flex flex-wrap items-center gap-3">
                <input name="playlistId" type="hidden" value={playlist.id} />
                <input name="visibility" type="hidden" value={playlist.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC"} />
                <button className="button-secondary" type="submit">
                  {playlist.visibility === "PUBLIC" ? "取消公开" : "生成分享链接"}
                </button>
                {playlist.visibility === "PUBLIC" && playlist.shareToken && (
                  <code className="text-sm text-[var(--text-muted)]">/playlists/share/{playlist.shareToken}</code>
                )}
              </form>
            </section>
            <section className="surface mt-8 p-6">
              <h2 className="text-xl font-semibold">协作者</h2>
              <form action={addPlaylistCollaboratorAction} className="mt-4 flex gap-3">
                <input name="playlistId" type="hidden" value={playlist.id} />
                <input className="field" name="email" placeholder="GitHub 账号邮箱" required type="email" />
                <button className="button-secondary" type="submit">添加</button>
              </form>
              {playlist.collaborators.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
                  {playlist.collaborators.map((collaborator) => (
                    <li className="flex items-center justify-between gap-3" key={collaborator.userId}>
                      <span>{collaborator.name ?? collaborator.email ?? "未提供资料"} · 编辑者</span>
                      <form action={removePlaylistCollaboratorAction}>
                        <input name="playlistId" type="hidden" value={playlist.id} />
                        <input name="userId" type="hidden" value={collaborator.userId} />
                        <button className="button-secondary" type="submit">移除</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        {playlist.role === "EDITOR" && (
          <div className="surface mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-xl font-semibold">离开歌单</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">离开后将无法继续编辑此歌单。</p>
            </div>
            <LeavePlaylistForm action={leavePlaylistAction} playlistId={playlist.id} />
          </div>
        )}
        <form action={updatePlaylistAction} className="surface mt-8 grid gap-4 p-6 sm:grid-cols-2">
          <input name="playlistId" type="hidden" value={playlist.id} />
          <label>
            <span className="block text-sm text-[var(--text-secondary)]">名称</span>
            <input className="field mt-2" defaultValue={playlist.name} maxLength={100} name="name" required />
          </label>
          <label>
            <span className="block text-sm text-[var(--text-secondary)]">说明</span>
            <input className="field mt-2" defaultValue={playlist.description ?? ""} maxLength={500} name="description" />
          </label>
          <div className="sm:col-span-2"><button className="button-primary" type="submit">保存</button></div>
        </form>
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
              <div className="mt-3 flex flex-wrap gap-2">
                <MoveForm direction="up" playlistId={playlist.id} songId={entry.songId} />
                <MoveForm direction="down" playlistId={playlist.id} songId={entry.songId} />
                <form action={removePlaylistSongAction}>
                  <input name="playlistId" type="hidden" value={playlist.id} />
                  <input name="songId" type="hidden" value={entry.songId} />
                  <button className="button-secondary" type="submit">移除</button>
                </form>
              </div>
            </div>
          ))}
        </div>
        {playlist.entries.length === 0 && (
          <p className="state-panel mt-10 text-[var(--text-secondary)]">从歌曲详情页将歌曲加入此歌单。</p>
        )}
      </PageContainer>
    </main>
  );
}

function MoveForm({
  direction,
  playlistId,
  songId,
}: {
  direction: "up" | "down";
  playlistId: string;
  songId: string;
}) {
  return (
    <form action={movePlaylistSongAction}>
      <input name="playlistId" type="hidden" value={playlistId} />
      <input name="songId" type="hidden" value={songId} />
      <input name="direction" type="hidden" value={direction} />
      <button className="button-secondary" type="submit">{direction === "up" ? "上移" : "下移"}</button>
    </form>
  );
}
