'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, Tv, Play, Search, X, Loader2, TrendingUp, Trophy, ChevronRight, ChevronLeft, CalendarDays, Flame, Sparkles } from 'lucide-react';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { apiUrl } from '@/lib/apiBase';
import { animeHref, watchHref } from '@/lib/routes';

// ── AniList ──────────────────────────────────────────────────────────────────
const CRITICAL_CACHE_KEY = 'home_critical_v2';
const SECONDARY_CACHE_KEY = 'home_secondary_v2';
const HOME_CACHE_TTL_MS = 15 * 60 * 1000;

function getCache(key) {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const { data, expiry } = JSON.parse(stored);
    if (Date.now() > expiry) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + HOME_CACHE_TTL_MS }));
  } catch {}
}

async function anilist(query, variables = {}) {
  try {
    const r = await fetch(apiUrl('/api/anilist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) {
      if (r.status === 429) throw new Error('Rate limited');
      throw new Error(`HTTP ${r.status}`);
    }
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    return j.data;
  } catch (err) {
    console.error('AniList fetch error:', err.message);
    throw new Error('Failed to fetch data');
  }
}

// ── Queries ────────────────────────────────────────────────────────────────────────────
const CRITICAL_QUERY = `
query {
  trending: Page(perPage: 12) {
    media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  airing: Page(perPage: 12) {
    media(status: RELEASING, sort: POPULARITY_DESC, type: ANIME, isAdult: false, format_in: [TV, TV_SHORT]) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
}`;

const SECONDARY_QUERY = `
query {
  popular: Page(perPage: 18) {
    media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  topRated: Page(perPage: 18) {
    media(sort: SCORE_DESC, type: ANIME, isAdult: false, episodes_greater: 1) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  upcoming: Page(perPage: 12) {
    media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  movies: Page(perPage: 12) {
    media(format: MOVIE, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  action: Page(perPage: 12) {
    media(genre_in: ["Action"], sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  romance: Page(perPage: 12) {
    media(genre_in: ["Romance"], sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  fantasy: Page(perPage: 12) {
    media(genre_in: ["Fantasy"], sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
  comedy: Page(perPage: 12) {
    media(genre_in: ["Comedy"], sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      idMal id bannerImage season seasonYear
      title { romaji english }
      coverImage { extraLarge large }
      episodes meanScore genres status format nextAiringEpisode { episode }
    }
  }
}`;

const SUGGEST_QUERY = `
query ($s: String) {
  Page(perPage: 8) {
    media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
      idMal id title { romaji english } coverImage { medium } meanScore status episodes
    }
  }
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function mediaTitle(m) { return m.title?.english || m.title?.romaji || ''; }

function mediaHref(m) {
  if (m?.id) return animeHref(m.id);
  const title = mediaTitle(m);
  if (title) return `/search?q=${encodeURIComponent(title)}`;
  return '/';
}

function normalizeJikanAnime(item) {
  if (!item?.mal_id) return null;
  return {
    id: null,
    idMal: item.mal_id,
    title: {
      romaji: item.title || item.title_english || item.title_japanese || 'Unknown',
      english: item.title_english || item.title || item.title_japanese || 'Unknown',
    },
    coverImage: {
      extraLarge: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || null,
      large: item.images?.jpg?.image_url || item.images?.jpg?.large_image_url || null,
    },
    episodes: item.episodes || null,
    meanScore: item.score ? Math.round(item.score * 10) : null,
    genres: Array.isArray(item.genres) ? item.genres.map(g => g.name).filter(Boolean) : [],
    status: item.status === 'Currently Airing' ? 'RELEASING' : String(item.status || '').toUpperCase().replace(/\s+/g, '_'),
    format: item.type ? String(item.type).toUpperCase().replace(/\s+/g, '_') : null,
    nextAiringEpisode: null,
    bannerImage: null,
  };
}

function mediaIdentity(media, index = 0) {
  if (media?.id != null) return `id-${media.id}`;
  if (media?.idMal != null) return `mal-${media.idMal}`;
  const normalizedTitle = mediaTitle(media).trim().toLowerCase();
  if (normalizedTitle) return `title-${normalizedTitle}`;
  return `idx-${index}`;
}

async function fetchJikanList(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.map(normalizeJikanAnime).filter(Boolean) : [];
}

async function fetchJikanFallbackHome() {
  const [top, airing, popular, seasonNow] = await Promise.allSettled([
    fetchJikanList('https://api.jikan.moe/v4/top/anime?limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/top/anime?filter=airing&limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/seasons/now?limit=24'),
  ]);
  const get = (r) => (r.status === 'fulfilled' ? r.value : []);
  const topList = get(top);
  const airingList = get(airing);
  const popularList = get(popular);
  const seasonList = get(seasonNow);
  return {
    provider: 'jikan',
    trending: { media: seasonList.length ? seasonList : topList },
    airing: { media: airingList.length ? airingList : seasonList },
    popular: { media: popularList.length ? popularList : topList },
    topRated: { media: topList },
    upcoming: { media: seasonList },
    movies: { media: topList.filter(m => m.format === 'MOVIE') },
    action: { media: seasonList.filter(m => m.genres?.includes('Action')) },
    romance: { media: seasonList.filter(m => m.genres?.includes('Romance')) },
    fantasy: { media: seasonList.filter(m => m.genres?.includes('Fantasy')) },
    comedy: { media: seasonList.filter(m => m.genres?.includes('Comedy')) },
  };
}

function getSectionMedia(data, key) {
  const source = data?.[key]?.media || [];
  const seen = new Set();
  return source.filter((media, index) => {
    if (!media) return false;
    const identity = mediaIdentity(media, index);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

// ── AnimeCard ─────────────────────────────────────────────────────────────────
function AnimeCard({ anime }) {
  const title = mediaTitle(anime);
  const img   = anime.coverImage?.large ?? anime.coverImage?.extraLarge;
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const eps   = anime.nextAiringEpisode?.episode
    ? `EP ${anime.nextAiringEpisode.episode - 1}`
    : anime.episodes ? `${anime.episodes} eps` : null;

  return (
    <article className="group">
      <Link href={mediaHref(anime)} className="block relative aspect-[2/3] overflow-hidden rounded-lg bg-white/5">
        {img && (
          <img
            src={img}
            alt={title}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play size={24} fill="white" className="text-white" />
        </div>
        {score && (
          <div className="absolute top-1.5 left-1.5 bg-black/80 px-1.5 py-0.5 rounded text-yellow-400 text-[10px] font-bold">
            {score}
          </div>
        )}
        {eps && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-white text-[10px]">
            {eps}
          </div>
        )}
      </Link>
      <h3 className="mt-2 text-[12px] font-medium text-gray-200 line-clamp-2 leading-tight group-hover:text-white">
        {title}
      </h3>
    </article>
  );
}

// ── SearchBar ──────────────────────────────────────────────────────────────────
function SearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (term) => {
    if (!term.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const data = await anilist(SUGGEST_QUERY, { s: term });
      const media = (data?.Page?.media || []).filter(m => m.id);
      setResults(media);
      setOpen(media.length > 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchSuggestions(val), 280);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (q.trim()) { setOpen(false); router.push(`/search?q=${encodeURIComponent(q.trim())}`); }
  };

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-sm">
      <form onSubmit={handleSubmit} className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={q}
          onChange={handleChange}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search..."
          className="w-full bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-rose-500/50"
        />
        {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500" />}
      </form>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#121212] border border-white/10 rounded-xl overflow-hidden z-50 shadow-2xl">
          {results.map(m => (
            <Link key={m.id} href={mediaHref(m)} onClick={() => { setOpen(false); setQ(''); }}
              className="flex items-center gap-3 p-2 hover:bg-white/5 transition-colors group">
              <img src={m.coverImage?.medium} className="w-8 h-12 object-cover rounded" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{mediaTitle(m)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{m.status}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────────
function Hero({ list }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!list?.length) return;
    const t = setInterval(() => setIdx(p => (p + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list]);

  if (!list?.length) return null;
  const anime = list[idx];
  const title = mediaTitle(anime);
  const bg = anime.bannerImage || anime.coverImage?.extraLarge;

  return (
    <section className="relative h-[240px] sm:h-[320px] overflow-hidden rounded-2xl bg-white/5">
      {bg && <img src={bg} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
      <div className="absolute bottom-0 left-0 p-6 sm:p-8 w-full max-w-xl">
        <h1 className="text-xl sm:text-3xl font-bold text-white line-clamp-1">{title}</h1>
        <div className="flex flex-wrap gap-2 mt-2 text-[10px] sm:text-xs text-gray-300">
          {anime.meanScore && <span className="text-yellow-400 font-bold">★ {anime.meanScore/10}</span>}
          <span>{anime.format}</span>
          <span>{anime.episodes} episodes</span>
        </div>
        <Link href={mediaHref(anime)} className="inline-flex items-center gap-2 mt-4 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-full transition-colors">
          <Play size={14} fill="white" /> Watch Now
        </Link>
      </div>
    </section>
  );
}

// ── Shelf ──────────────────────────────────────────────────────────────────────
function Shelf({ title, list }) {
  if (!list?.length) return null;
  return (
    <section className="py-4">
      <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 px-1">{title}</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
        {list.map(anime => <AnimeCard key={anime.id || anime.idMal} anime={anime} />)}
      </div>
    </section>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [data, setData] = useState(null);
  const [secondary, setSecondary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { items: continueWatching } = useContinueWatching(6);

  useEffect(() => {
    const cachedCritical = getCache(CRITICAL_CACHE_KEY);
    const cachedSecondary = getCache(SECONDARY_CACHE_KEY);
    if (cachedCritical) { setData(cachedCritical); setLoading(false); }
    if (cachedSecondary) setSecondary(cachedSecondary);
    if (cachedCritical && cachedSecondary) return;

    (async () => {
      try {
        const primary = await anilist(CRITICAL_QUERY);
        setData(primary);
        setCache(CRITICAL_CACHE_KEY, primary);
        setLoading(false);
        const sec = await anilist(SECONDARY_QUERY);
        setSecondary(sec);
        setCache(SECONDARY_CACHE_KEY, sec);
      } catch (err) {
        console.warn('Fallback to Jikan');
        try {
          const fallback = await fetchJikanFallbackHome();
          setData(fallback);
          setLoading(false);
        } catch { setError('Failed to load'); setLoading(false); }
      }
    })();
  }, []);

  const merged = useMemo(() => ({ ...data, ...secondary }), [data, secondary]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-gray-500">{error}</div>;

  const featured = getSectionMedia(merged, 'trending').slice(0, 6);

  return (
    <div className="max-w-screen-xl mx-auto px-4 pb-12">
      <header className="py-4 flex items-center justify-between gap-4 sticky top-0 z-40 bg-gray-950/80 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="w-6 h-6 bg-rose-600 rounded flex items-center justify-center"><Play size={12} fill="white" /></div>
          <span>AniStream</span>
        </Link>
        <SearchBar />
      </header>

      <main className="space-y-8">
        <Hero list={featured} />

        {continueWatching.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-400 uppercase mb-4 px-1">Continue Watching</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {continueWatching.map(item => (
                <Link key={item.id} href={watchHref(item.seasonId)} className="group relative aspect-video rounded-lg overflow-hidden bg-white/5">
                  <img src={item.coverImage} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50" />
                  <div className="absolute bottom-2 left-2 right-2">
                    <p className="text-[10px] font-bold text-white truncate">{item.title}</p>
                    <div className="h-1 w-full bg-white/20 mt-1 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-600" style={{ width: `${(item.episode/item.totalEpisodes)*100}%` }} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <Shelf title="Airing Now" list={getSectionMedia(merged, 'airing')} />
        <Shelf title="Trending" list={getSectionMedia(merged, 'trending')} />
        <Shelf title="Top Rated" list={getSectionMedia(merged, 'topRated')} />
        <Shelf title="Action" list={getSectionMedia(merged, 'action')} />
        <Shelf title="Romance" list={getSectionMedia(merged, 'romance')} />
      </main>

      <footer className="mt-16 pt-8 border-t border-white/5 text-center text-[10px] text-gray-600 uppercase tracking-widest">
        Powered by AniList & Jikan · Ad-free
      </footer>
    </div>
  );
}
