import Link from "next/link";

export default function SongNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0D1117] px-6 text-white">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-violet-300">404</p>
        <h1 className="mt-4 text-4xl font-bold">没有找到这首歌曲</h1>
        <Link className="mt-8 inline-block text-violet-300 hover:text-violet-200" href="/">
          返回首页
        </Link>
      </div>
    </main>
  );
}
