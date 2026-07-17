import Link from "next/link";
import type { SongListItemDto } from "@/lib/songs/dto";
import { SongMeta } from "@/components/song-meta";
import { TagList } from "@/components/tag-list";

export function SongCard({ song, context }: { song: SongListItemDto; context?: string }) {
  const alternate = song.names.find((name) => name.value !== song.title);
  return (
    <article className="catalog-card group">
      <div className="flex items-start justify-between gap-4">
        <p className="eyebrow text-[0.68rem]">{song.songType}</p>
        <span className="catalog-glyph" aria-hidden="true">♪</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
        <Link className="card-link" href={`/songs/${song.id}`}>{song.title}</Link>
      </h2>
      {alternate && <p className="mt-1 line-clamp-1 text-sm text-[var(--text-muted)]">{alternate.value}</p>}
      <p className="mt-4 line-clamp-2 text-[var(--text-secondary)]">{song.artistString}</p>
      {context && <p className="mt-3 text-sm text-[var(--accent-soft)]">{context}</p>}
      <SongMeta publishDate={song.publishDate} durationSeconds={song.durationSeconds} favoritedTimes={song.favoritedTimes} />
      <TagList tags={song.tags} limit={4} />
    </article>
  );
}
