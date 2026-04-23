'use client';

import Link from 'next/link';
import { ArrowLeft, Clock3, Loader2, Play, Tv } from 'lucide-react';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { watchHref } from '@/lib/routes';

function ContinueGridCard({ item }) {
  const progress = item.totalEpisodes
    ? Math.min(100, Math.max(0, (item.episode / item.totalEpisodes) * 100))
    : 0;

  return (
    <Link
      href={watchHref(item.seasonId)}
      className="group rounded-xl border border-white/10 bg-[#13121a] hover:border-rose-500/40 hover:shadow-xl hover:shadow-rose-950/20 transition-all duration-200 overflow-hidden"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-gray-900">
        {item.coverImage ? (
          <img
            src={item.coverImage}
            alt={item.title || 'Anime cover'}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Tv size={28} />
          </div>
        )}

        <div className="absolute inset-0 bg-black/65 group-hover:bg-black/45 transition-colors" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-11 h-11 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">
            <Play size={17} fill="white" className="text-white ml-0.5" />
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-gray-200 mt-1">
            Ep {item.episode}/{item.totalEpisodes || '?'}
          </p>
        </div>
      </div>

      <div className="p-3">
        <h2 className="line-clamp-2 text-sm font-semibold text-gray-100 leading-snug group-hover:text-white transition-colors">
          {item.title}
        </h2>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-2">
          <Clock3 size={12} />
          Continue from episode {item.episode}
        </div>
      </div>
    </Link>
  );
}

export default function ContinueWatchingPage() {
  const { items, loading, loadingMore, hasMore, loadMore } = useContinueWatching(20);

  return (
    <main className="relative min-h-screen bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-10 w-72 h-72 bg-rose-700/20 blur-[110px] rounded-full" />
        <div className="absolute top-20 right-0 w-72 h-72 bg-cyan-700/15 blur-[110px] rounded-full" />
      </div>

      <section className="relative max-w-screen-xl mx-auto px-4 pt-8 pb-14">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#15131d] via-[#12111a] to-[#12131b] p-4 sm:p-6 mb-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-100">Continue Watching</h1>
              <p className="text-sm text-gray-400 mt-1">Pick up exactly where you left off.</p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 transition"
            >
              <ArrowLeft size={15} /> Home
            </Link>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#12111a] p-8 text-center text-gray-300">
            <Loader2 className="mx-auto h-5 w-5 animate-spin mb-2" />
            Loading your watch history...
          </div>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#12111a] p-8 text-center text-gray-300">
            No anime in Continue Watching yet.
          </div>
        ) : null}

        {items.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {items.map((item) => (
                <ContinueGridCard key={`${item.id || item.seasonId}-${item.episode || 0}`} item={item} />
              ))}
            </div>

            {hasMore ? (
              <div className="flex justify-center mt-7">
                <button
                  onClick={() => loadMore(12)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition"
                >
                  {loadingMore ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
