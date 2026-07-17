export default function Loading() {
  return (
    <main className="min-h-screen bg-[#0D1117] px-6 py-20 text-slate-200">
      <div className="mx-auto max-w-5xl animate-pulse">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="mt-6 h-12 max-w-2xl rounded bg-white/10" />
        <div className="mt-4 h-6 w-64 rounded bg-white/10" />
      </div>
    </main>
  );
}
