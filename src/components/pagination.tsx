import Link from "next/link";

export function Pagination({ current, total, hrefForPage, label }: { current: number; total: number; hrefForPage: (page: number) => string; label: string }) {
  if (total <= 1) return null;
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return (
    <nav aria-label={label} className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {current > 1 && <PageLink href={hrefForPage(current - 1)}>上一页</PageLink>}
      {pages.map((page) => <PageLink current={page === current} href={hrefForPage(page)} key={page}>{page}</PageLink>)}
      {current < total && <PageLink href={hrefForPage(current + 1)}>下一页</PageLink>}
    </nav>
  );
}

function PageLink({ children, current = false, href }: { children: React.ReactNode; current?: boolean; href: string }) {
  return <Link aria-current={current ? "page" : undefined} className={current ? "page-link page-link-current" : "page-link"} href={href}>{children}</Link>;
}
