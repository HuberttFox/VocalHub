export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border-subtle)] py-8 text-sm text-[var(--text-muted)]">
      <div className="page-width flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>VocalHub · 本地优先的术曲资料目录</p>
        <p>
          歌曲元数据与图片链接来自{" "}
          <a
            className="text-[var(--accent-soft)] hover:text-white"
            href="https://vocadb.net"
            rel="noopener noreferrer"
            target="_blank"
          >
            VocaDB ↗
          </a>
          ；图片权利归各权利人。
        </p>
      </div>
    </footer>
  );
}
