export function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-[-0.04em] text-[var(--text-primary)] sm:text-6xl">{title}</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg">{description}</p>
    </header>
  );
}
