import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-width flex h-16 items-center justify-between gap-6">
        <Link className="brand-link" href="/" aria-label="VocalHub 首页">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span>VocalHub</span>
        </Link>
        <nav aria-label="主导航" className="flex items-center gap-1">
          <Link className="nav-link" href="/">首页</Link>
          <Link className="nav-link" href="/songs">歌曲目录</Link>
        </nav>
      </div>
    </header>
  );
}
