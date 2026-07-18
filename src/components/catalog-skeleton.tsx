export function CatalogSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="page-width py-12" aria-busy="true" aria-label="正在加载">
      <div className="skeleton h-4 w-28" />
      <div className="skeleton mt-5 h-12 max-w-xl" />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }, (_, index) => (
          <div
            className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-5"
            key={index}
          >
            <div className="skeleton aspect-square w-full" />
            <div className="skeleton mt-5 h-8 w-3/4" />
            <div className="skeleton mt-4 h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
