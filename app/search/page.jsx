'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Star, Play, Search, X, Loader2, ArrowLeft, Tv, Clapperboard } from 'lucide-react';

const AL = 'https://graphql.anilist.co';
async function anilist(query, variables = {}) {
  try {
    const r = await fetch('/api/anilist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) {
      if (r.status === 429) return null;
      throw new Error(`HTTP ${r.status}`);
    }
    const j = await r.json();
    return j.data;
  } catch (err) {
    console.error('AniList fetch error:', err.message);
    return null;
  }
}

const SEARCH_QUERY = `
query ($s: String, $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { total currentPage lastPage }
    media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
      idMal id title { romaji english } coverImage { extraLarge large }
      episodes meanScore status format genres
    }
  }
}`;

function mediaTitle(m) { return m.title?.english || m.title?.romaji || ''; }

function AnimeCard({ anime }) {
  const title = mediaTitle(anime);
  const img   = anime.coverImage?.extraLarge ?? anime.coverImage?.large;
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const format = anime.format ? anime.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={`/watch/${anime.id}`}
      className="group relative flex flex-col rounded-xl overflow-hidden bg-gray-900 border border-white/5
                 hover:border-rose-500/40 hover:shadow-xl hover:shadow-rose-950/30 transition-all duration-200"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-gray-800">
        {img
          ? <img src={img} alt={title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-600"><Tv size={32} /></div>
        }
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity w-12 h-12 rounded-full bg-rose-600/90 flex items-center justify-center">
            <Play size={20} fill="white" className="ml-0.5" />
          </div>
        </div>
        {score && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-yellow-400 text-xs font-bold">
            <Star size={10} fill="currentColor" />{score}
          </div>
        )}
        {anime.episodes && (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-gray-300 text-xs">{anime.episodes} eps</div>
        )}
        {format && (
          <div className="absolute bottom-2 right-2 bg-rose-600/90 backdrop-blur-sm px-2 py-0.5 rounded-full">
            <span className="text-white text-[10px] font-semibold uppercase">{format}</span>
          </div>
        )}
        {anime.status === 'RELEASING' && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-rose-600/90 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-white text-[10px] font-semibold">AIRING</span>
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <h3 className="text-sm font-semibold text-gray-100 leading-snug line-clamp-2 group-hover:text-white transition-colors">{title}</h3>
        <div className="flex flex-wrap gap-1 mt-auto pt-1">
          {anime.genres?.slice(0, 2).map(g => (
            <span key={g} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[10px]">{g}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── Inner search UI (needs useSearchParams so must be in Suspense) ─────────────
function SearchInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') || '';

  const [q, setQ]           = useState(initialQ);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal]   = useState(0);
  const timerRef            = useRef(null);

  const doSearch = useCallback(async (term) => {
    if (!term.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const data = await anilist(SEARCH_QUERY, { s: term, page: 1 });
      const media = (data?.Page?.media || []).filter(m => m.id);
      setResults(media);
      setTotal(data?.Page?.pageInfo?.total ?? media.length);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  // Run on mount with URL query
  useEffect(() => { doSearch(initialQ); }, [initialQ, doSearch]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      router.replace(val.trim() ? `/search?q=${encodeURIComponent(val.trim())}` : '/search', { scroll: false });
      doSearch(val);
    }, 300);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (q.trim()) { clearTimeout(timerRef.current); router.replace(`/search?q=${encodeURIComponent(q.trim())}`); doSearch(q); }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur border-b border-white/5">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-rose-600 flex items-center justify-center">
              <Play size={13} fill="white" className="ml-0.5" />
            </div>
            <span className="text-lg font-bold tracking-tight hidden sm:block">Ani<span className="text-rose-500">Stream</span></span>
          </Link>

          <form onSubmit={handleSubmit} className="flex-1 max-w-xl">
            <div className="relative">
              {loading
                ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
                : <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              }
              <input
                autoFocus
                value={q}
                onChange={handleChange}
                placeholder="Search anime…"
                className="w-full bg-gray-900/60 border border-white/10 rounded-full py-2 pl-9 pr-9
                           text-sm text-white placeholder-gray-500 focus:outline-none focus:border-rose-500/50 transition-colors"
              />
              {q && (
                <button type="button" onClick={() => { setQ(''); setResults([]); router.replace('/search'); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  <X size={13} />
                </button>
              )}
            </div>
          </form>

          <Link href="/" className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0" title="Back home">
            <ArrowLeft size={18} className="text-gray-400" />
          </Link>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-8">
        {/* Status line */}
        <div className="mb-6 flex items-center gap-3">
          {q ? (
            <h1 className="text-xl font-bold">
              Results for <span className="text-rose-400">"{q}"</span>
              {total > 0 && <span className="ml-2 text-sm font-normal text-gray-500">{total}+ matches</span>}
            </h1>
          ) : (
            <h1 className="text-xl font-bold text-gray-400">Start typing to search…</h1>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={32} className="animate-spin text-rose-500" />
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {results.map(a => <AnimeCard key={a.id} anime={a} />)}
          </div>
        ) : q && !loading ? (
          <div className="text-center py-24 text-gray-500">No results for "{q}"</div>
        ) : null}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-rose-500" />
      </div>
    }>
      <SearchInner />
    </Suspense>
  );
}
