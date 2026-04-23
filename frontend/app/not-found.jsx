import Link from 'next/link';
import { Compass, Home, Search, TriangleAlert } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
      <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 sm:p-10 shadow-2xl shadow-black/30">
        <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-200">
          <TriangleAlert size={14} />
          Page not found
        </div>

        <h1 className="mt-5 text-3xl sm:text-4xl font-black tracking-tight text-white">
          That anime page does not exist.
        </h1>
        <p className="mt-3 max-w-xl text-sm sm:text-base text-gray-400 leading-relaxed">
          The link may be broken, the page may have moved, or the route was typed incorrectly.
          You can head back home or jump straight into search.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
          >
            <Home size={16} />
            Go Home
          </Link>
          <Link
            href="/search"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
          >
            <Search size={16} />
            Open Search
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
            <Compass size={16} className="text-cyan-400" />
            Popular routes
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/homepage" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-gray-300 hover:bg-white/10">
              /homepage
            </Link>
            <Link href="/search" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-gray-300 hover:bg-white/10">
              /search
            </Link>
            <Link href="/continue-watching" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-gray-300 hover:bg-white/10">
              /continue-watching
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
