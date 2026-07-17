import { formatDate, formatDuration } from "@/lib/songs/format";

export function SongMeta({ publishDate, durationSeconds, favoritedTimes }: { publishDate: string | null; durationSeconds: number; favoritedTimes: number }) {
  return (
    <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--text-muted)]">
      <div><dt className="sr-only">发布时间</dt><dd>{formatDate(publishDate)}</dd></div>
      <div><dt className="sr-only">时长</dt><dd>{formatDuration(durationSeconds)}</dd></div>
      <div><dt className="sr-only">VocaDB 收藏数</dt><dd>{favoritedTimes} VocaDB 收藏</dd></div>
    </dl>
  );
}
