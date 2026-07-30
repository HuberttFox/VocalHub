import Link from "next/link";
import type { TagListItemDto } from "@/lib/tags/dto";

export function TagCard({ tag }: { tag: TagListItemDto }) {
  return (
    <article className="catalog-card group">
      <div className="flex items-start justify-between gap-4">
        <p className="eyebrow text-[0.68rem]">Tag</p>
        <span className="catalog-glyph" aria-hidden="true">●</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
        <Link className="card-link" href={`/tags/${tag.id}`}>{tag.name}</Link>
      </h2>
      {tag.additionalNames.length > 0 && (
        <p className="mt-1 line-clamp-1 text-sm text-[var(--text-muted)]">
          {tag.additionalNames.slice(0, 3).join(" · ")}
        </p>
      )}
      <p className="mt-4 text-[var(--text-secondary)]">{tag.publicSongCount} 首公开歌曲</p>
    </article>
  );
}
