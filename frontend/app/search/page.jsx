'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Star, Play, Search, X, Loader2, ArrowLeft, Tv } from 'lucide-react';
import { apiUrl } from '@/lib/apiBase';
import { animeHref } from '@/lib/routes';

async function anilist(query, variables = {}) {
  try {
    const r = await fetch(apiUrl('/api/anilist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    return j.data;
  } catch (err) {
    console.error('Search error:', err);
    return null;
  }
}

const SEARCH_QUERY = `
query ($s: String, $page: Int) {
  Page(page: $page, perPage: 24) {
    media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
      id title { romaji english } coverImage { large }
      episodes meanScore status format
    }
  }
}`;

function AnimeCard({ anime }) {
  const title = anime.title?.english || anime.title?.romaji;
  return (
    <Link href={animeHref(anime.id)} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/5">
        <img src={anime.coverImage?.large} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play size={24} fill="white" className="text-white" />
        </div>
        {anime.meanScore && (
          <div className="absolute top-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-yellow-400 text-[10px] font-bold">
            ★ {(anime.meanScore / 10).toFixed(1)}
          </div>
        )}
      </div>
      <h3 className="mt-2 text-[12px] font-medium text-gray-400 line-clamp-2 group-hover:text-white leading-tight">{title}</h3>
    </Link>
  );
}

function SearchInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQ = searchParams.get('q') || '';
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const doSearch = useCallback(async (term) => {
    if (!term.trim()) { setResults([]); return; }
    setLoading(true);
    const data = await anilist(SEARCH_QUERY, { s: term, page: 1 });
    setResults(data?.Page?.media || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (initialQ) doSearch(initialQ); }, [initialQ, doSearch]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      router.replace(val.trim() ? `/search?q=${encodeURIComponent(val.trim())}` : '/search', { scroll: false });
      doSearch(val);
    }, 300);
  };

  return (
    <div className="max-w-screen-xl mx-auto px-4 pb-12">
      <header className="py-4 flex items-center gap-4 sticky top-0 z-40 bg-gray-950/80 backdrop-blur-sm">
        <Link href="/" className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="relative flex-1 max-w-xl">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            autoFocus
            value={q}
            onChange={handleChange}
            placeholder="Search anime..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-rose-500/50"
          />
          {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500" />}
        </div>
      </header>

      <main className="mt-8">
        {!q && <div className="text-center py-24 text-gray-500 text-sm">Start typing to search...</div>}
        {results.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {results.map(a => <AnimeCard key={a.id} anime={a} />)}
          </div>
        )}
        {q && !loading && results.length === 0 && <div className="text-center py-24 text-gray-500 text-sm">No results found</div>}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>}>
      <SearchInner />
    </Suspense>
  );
}
