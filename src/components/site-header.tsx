import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/auth";
import { getViewer } from "@/lib/auth/session";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-width flex min-h-16 flex-wrap items-center justify-between gap-4 py-2">
        <Link className="brand-link" href="/" aria-label="VocalHub 首页">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span>VocalHub</span>
        </Link>
        <nav aria-label="主导航" className="flex flex-wrap items-center gap-1">
          <Link className="nav-link" href="/">首页</Link>
          <Link className="nav-link" href="/songs">歌曲目录</Link>
          <Suspense fallback={<span className="nav-link">账号</span>}>
            <AccountNavigation />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

async function AccountNavigation() {
  const viewer = await getViewer();
  if (!viewer) {
    return <Link className="nav-link" href="/signin">登录</Link>;
  }
  return (
    <>
      <Link className="nav-link" href="/favorites">我的收藏</Link>
      <Link className="nav-link" href="/playlists">我的歌单</Link>
      <Link className="nav-link" href="/settings" title={viewer.name ?? "账号设置"}>{viewer.name ?? "账号设置"}</Link>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="nav-link" type="submit">退出</button>
      </form>
    </>
  );
}
