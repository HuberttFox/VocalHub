const features = [
  "VocaDB 数据同步",
  "歌曲与作者搜索",
  "中文化资料整理",
  "收藏与歌单",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0D1117] text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-20">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.35em] text-violet-300">
          VocalHub
        </p>
        <h1 className="max-w-3xl text-5xl font-bold tracking-tight sm:text-7xl">
          探索虚拟歌声的无限可能
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          面向中文用户的现代术曲发现平台，聚合 Vocaloid、Synthesizer V、UTAU
          等音乐资料，提供搜索、浏览、收藏和后续推荐能力。
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-200"
              key={feature}
            >
              {feature}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
