import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { SongCard } from "@/components/song-card";
import { getPublicPlaylist } from "@/lib/playlists/repository";

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
      </PageContainer>
    </main>
  );
}
