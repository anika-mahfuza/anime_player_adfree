'use client';

import Link from 'next/link';
import { Home, RefreshCcw, Search, TriangleAlert } from 'lucide-react';

export default function Error({ error, reset }) {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
      <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 sm:p-10 shadow-2xl shadow-black/30">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
          <TriangleAlert size={14} />
          Something went wrong
        </div>

        <h1 className="mt-5 text-3xl sm:text-4xl font-black tracking-tight text-white">
          This page hit an unexpected error.
        </h1>
        <p className="mt-3 max-w-xl text-sm sm:text-base text-gray-400 leading-relaxed">
          Try the page again, go back home, or search for the anime directly.
        </p>

        {error?.message ? (
          <div className="mt-5 rounded-2xl border border-white/8 bg-black/25 p-4 text-xs text-gray-400">
            {error.message}
          </div>
        ) : null}

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
          >
            <RefreshCcw size={16} />
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
          >
            <Home size={16} />
            Home
          </Link>
          <Link
            href="/search"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
          >
            <Search size={16} />
            Search
          </Link>
        </div>
      </section>
    </main>
  );
}
