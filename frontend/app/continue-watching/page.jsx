'use client';

import Link from 'next/link';
import { ArrowLeft, Clock3, Loader2, Play } from 'lucide-react';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { watchHref } from '@/lib/routes';

function ContinueGridCard({ item }) {
  const progress = item.totalEpisodes
    ? Math.min(100, Math.max(0, (item.episode / item.totalEpisodes) * 100))
    : 0;

  return (
    <Link href={watchHref(item.seasonId)} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/5">
        {item.coverImage && <img src={item.coverImage} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play size={24} fill="white" className="text-white" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-rose-600" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-2">
        <h2 className="text-[12px] font-medium text-gray-400 line-clamp-1 group-hover:text-white transition-colors">{item.title}</h2>
        <p className="text-[10px] text-gray-600 mt-0.5">Episode {item.episode} / {item.totalEpisodes || '?'}</p>
      </div>
    </Link>
  );
}

export default function ContinueWatchingPage() {
  const { items, loading, loadingMore, hasMore, loadMore } = useContinueWatching(20);

  return (
    <main className="max-w-screen-xl mx-auto px-4 pb-12">
      <header className="py-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Continue Watching</h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-bold">Your History</p>
        </div>
        <Link href="/" className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <ArrowLeft size={18} />
        </Link>
      </header>

      {loading && items.length === 0 ? (
        <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-rose-500" /></div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center text-gray-500 text-sm">No watch history found</div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {items.map((item) => (
              <ContinueGridCard key={`${item.id || item.seasonId}-${item.episode}`} item={item} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-12 flex justify-center">
              <button onClick={() => loadMore(12)} disabled={loadingMore} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs font-bold transition-all">
                {loadingMore ? 'Loading...' : 'Load more history'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
