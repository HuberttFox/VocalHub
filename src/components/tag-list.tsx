export function TagList({ tags, limit }: { tags: Array<{ id: string; name: string }>; limit?: number }) {
  const visible = limit ? tags.slice(0, limit) : tags;
  if (visible.length === 0) return null;
  return <ul className="mt-5 flex flex-wrap gap-2" aria-label="标签">{visible.map((tag) => <li className="tag-chip" key={tag.id}>{tag.name}</li>)}</ul>;
}
