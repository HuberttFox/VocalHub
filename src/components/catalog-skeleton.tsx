export function CatalogSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="page-width py-12" aria-busy="true" aria-label="正在加载">
      <div className="skeleton h-4 w-28" />
      <div className="skeleton mt-5 h-12 max-w-xl" />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }, (_, index) => <div className="skeleton h-64 rounded-[var(--radius-card)]" key={index} />)}
      </div>
    </div>
  );
}
