export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border-subtle)] py-8 text-sm text-[var(--text-muted)]">
      <div className="page-width flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>VocalHub · 本地优先的术曲资料目录</p>
        <p>元数据来源于 VocaDB；页面请求仅读取本地 PostgreSQL。</p>
      </div>
    </footer>
  );
}
