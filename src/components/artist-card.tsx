import Link from "next/link";
import { RemoteImage } from "@/components/remote-image";
import type { ArtistListItemDto } from "@/lib/artists/list-dto";

export function ArtistCard({ artist }: { artist: ArtistListItemDto }) {
  return (
    <article className="catalog-card group">
      <RemoteImage
        alt={`${artist.name} 头像`}
        className="catalog-cover aspect-square"
        fallbackIcon="person"
        fallbackLabel="作者头像不可用"
        height={640}
        src={artist.avatarUrl}
        width={640}
      />
      <div className="mt-5 flex items-start justify-between gap-4">
        <p className="eyebrow text-[0.68rem]">Artist</p>
        <span className="catalog-glyph" aria-hidden="true">●</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
        <Link className="card-link" href={`/artists/${artist.id}`}>{artist.name}</Link>
      </h2>
      {artist.aliases.length > 0 && (
        <p className="mt-1 line-clamp-1 text-sm text-[var(--text-muted)]">
          {artist.aliases.slice(0, 3).map((alias) => alias.value).join(" · ")}
        </p>
      )}
      <p className="mt-4 text-[var(--text-secondary)]">{artist.publicSongCount} 首公开作品</p>
    </article>
  );
}
