import Link from "next/link";
import type { ReactNode } from "react";

export function EmptyState({ eyebrow = "Empty", title, description, href, action }: { eyebrow?: string; title: string; description: string; href?: string; action?: string }) {
  return (
    <section className="state-panel">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-[var(--text-secondary)]">{description}</p>
      {href && action && <Link className="button-secondary mt-6" href={href}>{action}</Link>}
    </section>
  );
}

export function ErrorState({ code = "Error", title, description, action }: { code?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <section className="state-panel">
      <p className="eyebrow">{code}</p>
      <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)]">{title}</h1>
      <p className="mx-auto mt-3 max-w-lg text-[var(--text-secondary)]">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </section>
  );
}
