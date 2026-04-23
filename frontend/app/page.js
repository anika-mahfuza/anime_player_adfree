'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, Tv, Play, Search, X, Loader2, TrendingUp, Trophy, ChevronRight, ChevronLeft, CalendarDays, Flame, Sparkles } from 'lucide-react';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { apiUrl } from '@/lib/apiBase';
import { animeHref, watchHref } from '@/lib/routes';

// ── AniList ──────────────────────────────────────────────────────────────────
// Two separate caches — critical can be served while secondary still loads
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
      if (r.status === 429) throw new Error('Rate limited. Please wait a moment and try again.');
      throw new Error(`HTTP ${r.status}`);
    }
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    return j.data;
  } catch (err) {
    console.error('AniList fetch error:', err.message);
    throw new Error('Failed to fetch data. Please try again.');
  }
}

// ── Queries ────────────────────────────────────────────────────────────────────────────
// Critical: loads first — powers the hero + first 2 shelves. Small payload.
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

// Secondary: loads in background after critical is painted.
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
function AnimeCard({ anime, compact = false }) {
  const title = mediaTitle(anime);
  const img   = anime.coverImage?.extraLarge ?? anime.coverImage?.large;
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const eps   = anime.nextAiringEpisode?.episode
    ? `EP ${anime.nextAiringEpisode.episode - 1}`
    : anime.episodes ? `${anime.episodes} eps` : null;
  const format = anime.format ? anime.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={mediaHref(anime)}
      className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all duration-200
                  ${compact
                    ? 'bg-gray-900/60 border-white/10 hover:border-white/25 hover:bg-gray-800/80'
                    : 'bg-gray-900 border-white/5 hover:border-rose-500/40 hover:shadow-xl hover:shadow-rose-950/30'}`}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-gray-800">
        {img
          ? <img src={img} alt={title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-600"><Tv size={32} /></div>
        }
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-12 h-12 rounded-full bg-rose-600/90 flex items-center justify-center shadow-lg">
            <Play size={20} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        {score && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-yellow-400 text-xs font-bold">
            <Star size={10} fill="currentColor" />{score}
          </div>
        )}
        {eps && (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-gray-300 text-xs">{eps}</div>
        )}
        {format && (
          <div className="absolute bottom-2 right-2 bg-rose-600/90 backdrop-blur-sm px-2 py-0.5 rounded-full">
            <span className="text-white text-[10px] font-semibold uppercase">{format}</span>
          </div>
        )}
        {anime.status === 'RELEASING' && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-rose-600/90 backdrop-blur-sm px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-white text-[10px] font-semibold">AIRING</span>
          </div>
        )}
      </div>
      <div className={`flex flex-col gap-1.5 flex-1 ${compact ? 'p-2.5' : 'p-3'}`}>
        <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-gray-100 leading-snug line-clamp-2 group-hover:text-white transition-colors`}>{title}</h3>
        <div className="flex flex-wrap gap-1 mt-auto pt-1">
          {anime.genres?.slice(0, 2).map(g => (
            <span key={g} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[10px]">{g}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── Live search dropdown ───────────────────────────────────────────────────────
function SearchBar() {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef              = useRef(null);
  const wrapRef               = useRef(null);
  const router                = useRouter();

  // Close dropdown on outside click
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

  const clear = () => { setQ(''); setResults([]); setOpen(false); };

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-md">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          {loading
            ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
            : <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          }
          <input
            value={q}
            onChange={handleChange}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search anime…"
            className="w-full bg-gray-900/60 border border-white/10 rounded-full py-2 pl-9 pr-8
                       text-sm text-white placeholder-gray-500 focus:outline-none focus:border-rose-500/50 transition-colors"
          />
          {q && (
            <button type="button" onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X size={13} />
            </button>
          )}
        </div>
      </form>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          {results.map(m => {
            const t = mediaTitle(m);
            const score = m.meanScore ? (m.meanScore / 10).toFixed(1) : null;
            return (
              <Link
                key={m.id}
                href={mediaHref(m)}
                onClick={() => { setOpen(false); setQ(''); }}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors group"
              >
                {m.coverImage?.medium && (
                  <img src={m.coverImage.medium} alt={t} className="w-8 h-12 object-cover rounded shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-100 group-hover:text-white truncate font-medium">{t}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {score && <span className="text-yellow-400 text-xs flex items-center gap-0.5"><Star size={9} fill="currentColor" />{score}</span>}
                    {m.episodes && <span className="text-gray-500 text-xs">{m.episodes} eps</span>}
                    <span className={`text-xs ${m.status === 'RELEASING' ? 'text-rose-400' : 'text-gray-600'}`}>
                      {m.status === 'RELEASING' ? 'Airing' : m.status === 'FINISHED' ? 'Finished' : m.status}
                    </span>
                  </div>
                </div>
                <Play size={14} className="text-gray-600 group-hover:text-rose-400 transition-colors shrink-0" />
              </Link>
            );
          })}
          <button
            onClick={handleSubmit}
            className="w-full px-3 py-2 text-xs text-gray-500 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5"
          >
            See all results for "{q}" →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Continue Watching Row ─────────────────────────────────────────────────────
function ContinueWatchingRow() {
  const { items, loading, hasMore } = useContinueWatching(6);
  const scrollRef = useRef(null);

  const scrollRow = useCallback((direction) => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(240, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="max-w-screen-xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-100">Continue Watching</h2>
        {hasMore && (
          <Link
            href="/continue-watching"
            className="flex items-center gap-1 text-sm text-rose-400 hover:text-rose-300 transition-colors"
          >
            View more <ChevronRight size={16} />
          </Link>
        )}
      </div>
      <div className="relative">
        <button
          aria-label="Scroll continue watching left"
          onClick={() => scrollRow(-1)}
          className="hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white/90 hover:bg-black/85 transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label="Scroll continue watching right"
          onClick={() => scrollRow(1)}
          className="hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white/90 hover:bg-black/85 transition-colors"
        >
          <ChevronRight size={15} />
        </button>

        <div 
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {items.map(item => (
            <ContinueCard key={`${item.id}-${item.episode}`} data={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroSpotlight({ list }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const total = list?.length || 0;
  const visibleIndex = total ? activeIndex % total : 0;
  const pointerStateRef = useRef({
    id: null,
    startX: 0,
    currentX: 0,
    dragging: false,
    moved: false,
  });
  const suppressClickRef = useRef(false);
  const pauseUntilRef = useRef(0);
  const pauseTimerRef = useRef(null);
  const slides = useMemo(() => {
    if (!list?.length) return [];
    return total > 1 ? [...list, list[0]] : list;
  }, [list, total]);

  const pauseAutoScroll = useCallback((durationMs = 3000) => {
    pauseUntilRef.current = Date.now() + durationMs;
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null;
      pauseUntilRef.current = 0;
    }, durationMs);
  }, []);

  const moveToSlide = useCallback((nextIndex) => {
    if (total <= 1) return;
    setIsAnimating(true);
    setActiveIndex(nextIndex);
  }, [total]);

  const moveBy = useCallback((direction) => {
    if (total <= 1) return;

    setIsAnimating(true);
    setActiveIndex((prev) => {
      const normalized = total ? prev % total : 0;
      if (direction > 0) {
        return normalized === total - 1 ? total : normalized + 1;
      }
      return normalized === 0 ? total - 1 : normalized - 1;
    });
  }, [total]);

  useEffect(() => {
    if (total <= 1) return;
    const timer = setInterval(() => {
      if (pointerStateRef.current.dragging) return;
      if (pauseUntilRef.current && Date.now() < pauseUntilRef.current) return;
      setActiveIndex((prev) => (prev + 1) % (total + 1));
    }, 2000);

    return () => clearInterval(timer);
  }, [total]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  const handleTransitionEnd = useCallback(() => {
    if (total <= 1) return;
    if (activeIndex !== total) return;

    // Snap cloned slide back to real first slide without visual rewind.
    setIsAnimating(false);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    });
  }, [activeIndex, total]);

  const handlePointerDown = useCallback((event) => {
    if (total <= 1) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    pointerStateRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      currentX: event.clientX,
      dragging: true,
      moved: false,
    };

    pauseAutoScroll();
  }, [pauseAutoScroll, total]);

  const handlePointerMove = useCallback((event) => {
    const state = pointerStateRef.current;
    if (!state.dragging || state.id !== event.pointerId) return;

    state.currentX = event.clientX;
    if (Math.abs(state.currentX - state.startX) > 12) {
      state.moved = true;
    }
  }, []);

  const finishPointerGesture = useCallback((event) => {
    const state = pointerStateRef.current;
    if (!state.dragging || state.id !== event.pointerId) return;

    const deltaX = state.currentX - state.startX;
    const moved = state.moved;

    pointerStateRef.current = {
      id: null,
      startX: 0,
      currentX: 0,
      dragging: false,
      moved: false,
    };

    if (!moved) return;

    pauseAutoScroll();
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    if (deltaX <= -40) {
      moveBy(1);
    } else if (deltaX >= 40) {
      moveBy(-1);
    }
  }, [moveBy, pauseAutoScroll]);

  const handlePointerCancel = useCallback((event) => {
    const state = pointerStateRef.current;
    if (state.id !== event.pointerId) return;
    pointerStateRef.current = {
      id: null,
      startX: 0,
      currentX: 0,
      dragging: false,
      moved: false,
    };
  }, []);

  const handleClickCapture = useCallback((event) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  if (!list?.length) return null;

  return (
    <section className="max-w-screen-xl mx-auto px-4 pt-6 pb-3">
      <div
        className="relative overflow-hidden rounded-2xl border border-white/10 h-[290px] sm:h-[360px]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={finishPointerGesture}
        onClickCapture={handleClickCapture}
        style={{ touchAction: 'pan-y' }}
      >
        <div
          onTransitionEnd={handleTransitionEnd}
          className={`flex h-full ${isAnimating ? 'transition-transform duration-700 ease-out' : ''}`}
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {slides.map((anime, idx) => {
            const title = mediaTitle(anime);
            const backdrop = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large;
            const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;

            return (
              <article key={`${anime.id || `mal-${anime.idMal}`}-hero-${idx}`} className="relative min-w-full h-full">
                {backdrop && (
                  <img
                    src={backdrop}
                    alt={title}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading={idx === 0 ? 'eager' : 'lazy'}
                  />
                )}

                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/30" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(244,63,94,0.25),transparent_50%)]" />

                <div className="relative z-10 p-5 sm:p-8 h-full flex flex-col justify-end gap-3 max-w-2xl">
                  <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-rose-300/90">
                    <Flame size={13} /> Featured Tonight
                  </div>

                  <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
                    {title}
                  </h1>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-200">
                    {score && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/45 border border-white/15 text-yellow-300">
                        <Star size={12} fill="currentColor" /> {score}
                      </span>
                    )}
                    {anime.format && <span className="px-2 py-1 rounded-full bg-black/45 border border-white/15">{anime.format.replace(/_/g, ' ')}</span>}
                    {anime.episodes && <span className="px-2 py-1 rounded-full bg-black/45 border border-white/15">{anime.episodes} eps</span>}
                    {anime.status && <span className="px-2 py-1 rounded-full bg-black/45 border border-white/15">{anime.status === 'RELEASING' ? 'Airing' : anime.status.replace(/_/g, ' ')}</span>}
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <Link
                      href={mediaHref(anime)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors"
                    >
                      <Play size={14} fill="currentColor" /> View Details
                    </Link>
                    <Link
                      href={`/search?q=${encodeURIComponent(title)}`}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/15 transition-colors"
                    >
                      Explore Similar
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {total > 1 && (
          <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5">
            {list.map((anime, idx) => (
              <button
                key={`${anime.id || `mal-${anime.idMal}`}-dot`}
                onClick={() => {
                  pauseAutoScroll();
                  moveToSlide(idx);
                }}
                aria-label={`Go to featured slide ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${idx === visibleIndex ? 'w-7 bg-white' : 'w-2 bg-white/45 hover:bg-white/70'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Shelf({ id, title, subtitle, list, compact = true }) {
  const railRef = useRef(null);

  const scrollRail = useCallback((direction) => {
    const el = railRef.current;
    if (!el) return;
    const amount = Math.max(260, Math.floor(el.clientWidth * 0.9));
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  if (!list.length) return null;

  return (
    <section id={id} className="max-w-screen-xl mx-auto px-4 py-4">
      <div className="flex items-end justify-between mb-3 gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-100">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="relative">
        <button
          aria-label={`Scroll ${title} left`}
          onClick={() => scrollRail(-1)}
          className="hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white/90 hover:bg-black/85 transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label={`Scroll ${title} right`}
          onClick={() => scrollRail(1)}
          className="hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white/90 hover:bg-black/85 transition-colors"
        >
          <ChevronRight size={15} />
        </button>

        <div
          ref={railRef}
          className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {list.map((anime) => (
            <div key={`${anime.id || `mal-${anime.idMal}`}`} className="snap-start w-36 sm:w-40 shrink-0">
              <AnimeCard anime={anime} compact={compact} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContinueCard({ data }) {
  const router = useRouter();
  
  return (
    <div 
      className="group relative flex-shrink-0 w-36 sm:w-40 cursor-pointer"
      onClick={() => router.push(watchHref(data.seasonId))}
    >
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-gray-900">
        {data.coverImage ? (
          <img src={data.coverImage} alt={data.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Tv size={24} />
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 group-hover:bg-black/40 transition-colors" />
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-rose-500 rounded-full"
              style={{ width: `${(data.episode / data.totalEpisodes) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-300 mt-1">
            Ep {data.episode}/{data.totalEpisodes}
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1 truncate group-hover:text-white transition-colors">
        {data.title}
      </p>
    </div>
  );
}

const SECTION_META = [
  { key: 'airing', id: 'airing', title: 'Airing Right Now', subtitle: 'Episodes currently releasing this season' },
  { key: 'trending', id: 'trending', title: 'Trending This Week', subtitle: 'Most watched and discussed right now' },
  { key: 'topRated', id: 'top-rated', title: 'Top Rated Legends', subtitle: 'Highest audience-rated titles' },
  { key: 'movies', id: 'movies', title: 'Anime Movies', subtitle: 'Big-screen stories worth your time' },
  { key: 'action', id: 'action', title: 'Action Pulse', subtitle: 'Fast, brutal, and high-energy picks' },
  { key: 'romance', id: 'romance', title: 'Romance & Feels', subtitle: 'Heartbreaks, confessions, and chemistry' },
  { key: 'fantasy', id: 'fantasy', title: 'Fantasy Worlds', subtitle: 'Magic, myths, and alternate realities' },
  { key: 'comedy', id: 'comedy', title: 'Comedy Break', subtitle: 'Lighter shows when you want to chill' },
  { key: 'upcoming', id: 'upcoming', title: 'Coming Soon', subtitle: 'Anticipated shows not released yet' },
  { key: 'popular', id: 'popular', title: 'All-Time Popular', subtitle: 'Evergreen favorites everyone knows' },
];

const FILTER_CHIPS = [
  { key: 'airing', label: 'Airing Now' },
  { key: 'topRated', label: 'Top Rated' },
  { key: 'movies', label: 'Movies' },
  { key: 'action', label: 'Action' },
  { key: 'romance', label: 'Romance' },
  { key: 'upcoming', label: 'Upcoming' },
];

export default function HomePage() {
  const [data, setData]       = useState(null);
  const [secondary, setSecondary] = useState(null);
  const [loading, setLoading]  = useState(true);  // true until critical ready
  const [error, setError]      = useState('');
  const [provider, setProvider] = useState('AniList');
  const [activeTopics, setActiveTopics] = useState([]);

  // Merge critical + secondary into one data object for existing consumers
  const mergedData = useMemo(() => {
    if (!data) return null;
    return { ...data, ...(secondary || {}) };
  }, [data, secondary]);

  const toggleTopic = useCallback((topicKey) => {
    setActiveTopics((prev) => (
      prev.includes(topicKey)
        ? prev.filter((key) => key !== topicKey)
        : [...prev, topicKey]
    ));
  }, []);

  const clearTopics = useCallback(() => {
    setActiveTopics([]);
  }, []);

  useEffect(() => {
    // ── Step 1: critical (trending + airing) — paint hero + first shelves fast
    const cachedCritical = getCache(CRITICAL_CACHE_KEY);
    const cachedSecondary = getCache(SECONDARY_CACHE_KEY);

    if (cachedCritical) {
      setData({ ...cachedCritical, provider: cachedCritical.provider || 'anilist' });
      setProvider(cachedCritical.provider === 'jikan' ? 'Jikan Fallback' : 'AniList');
      setLoading(false);
    }
    if (cachedSecondary) {
      setSecondary(cachedSecondary);
    }
    if (cachedCritical && cachedSecondary) return;

    (async () => {
      // Critical fetch (if not cached)
      if (!cachedCritical) {
        try {
          const primary = await anilist(CRITICAL_QUERY);
          const payload = { ...primary, provider: 'anilist' };
          setData(payload);
          setProvider('AniList');
          setCache(CRITICAL_CACHE_KEY, payload);
        } catch (critErr) {
          console.warn('[Home] AniList critical failed, trying Jikan:', critErr.message);
          try {
            const fallback = await fetchJikanFallbackHome();
            setData(fallback);
            setProvider('Jikan Fallback');
            setCache(CRITICAL_CACHE_KEY, fallback);
          } catch (fbErr) {
            setError(fbErr.message || 'Failed to load homepage');
          }
        } finally {
          setLoading(false);
        }
      }

      // Secondary fetch (if not cached) — don't block render
      if (!cachedSecondary) {
        try {
          const sec = await anilist(SECONDARY_QUERY);
          setSecondary(sec);
          setCache(SECONDARY_CACHE_KEY, sec);
        } catch (secErr) {
          console.warn('[Home] Secondary fetch failed:', secErr.message);
        }
      }
    })();
  }, []);

  const featuredList = useMemo(() => {
    const rankWeights = {
      airing: 28,
      trending: 22,
      topRated: 18,
      popular: 10,
    };

    const scoredPools = [
      ...getSectionMedia(mergedData, 'airing').slice(0, 12).map((anime) => ({ anime, source: 'airing' })),
      ...getSectionMedia(mergedData, 'trending').slice(0, 12).map((anime) => ({ anime, source: 'trending' })),
      ...getSectionMedia(mergedData, 'topRated').slice(0, 12).map((anime) => ({ anime, source: 'topRated' })),
      ...getSectionMedia(mergedData, 'popular').slice(0, 12).map((anime) => ({ anime, source: 'popular' })),
    ];

    const scoreEntry = (anime, source) => {
      const baseScore = Number(anime?.meanScore || 0);
      const hasBackdrop = anime?.bannerImage || anime?.coverImage?.extraLarge;
      const isAiring = anime?.status === 'RELEASING';
      const hasGenres = Array.isArray(anime?.genres) && anime.genres.length > 0;

      return (
        baseScore +
        (rankWeights[source] || 0) +
        (hasBackdrop ? 16 : 0) +
        (isAiring ? 12 : 0) +
        (hasGenres ? 4 : 0)
      );
    };

    const bestById = new Map();
    for (const { anime, source } of scoredPools) {
      const key = String(anime?.id || anime?.idMal || '');
      if (!key) continue;

      const nextScore = scoreEntry(anime, source);
      const existing = bestById.get(key);
      if (!existing || nextScore > existing.score) {
        bestById.set(key, { anime, score: nextScore });
      }
    }

    return Array.from(bestById.values())
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.anime)
      .slice(0, 6);
  }, [mergedData]);

  const popularGrid = getSectionMedia(mergedData, 'popular').slice(0, 18);

  const totalCards = SECTION_META.reduce((acc, section) => {
    return acc + getSectionMedia(mergedData, section.key).length;
  }, 0);

  const visibleSections = useMemo(() => {
    if (!activeTopics.length) return SECTION_META;
    const selected = new Set(activeTopics);
    return SECTION_META.filter((section) => selected.has(section.key));
  }, [activeTopics]);

  const isFiltering = activeTopics.length > 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(190,24,93,0.22),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(124,58,237,0.16),transparent_30%)]" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur border-b border-white/5">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-rose-600 flex items-center justify-center shadow-lg shadow-rose-900/50">
              <Play size={13} fill="white" className="text-white ml-0.5" />
            </div>
            <span className="text-lg font-bold tracking-tight">Ani<span className="text-rose-500">Stream</span></span>
          </Link>
          <SearchBar />
          <span className="text-xs text-gray-600 hidden sm:block shrink-0">Ad-free · Fast streams</span>
        </div>
      </header>

      <div className="relative z-10">
        {/* Hero */}
        {!loading && !error && (
          <HeroSpotlight
            key={featuredList.map((anime) => anime.id || `mal-${anime.idMal}`).join('|')}
            list={featuredList}
          />
        )}

        {/* Stats + quick nav */}
        {!loading && !error && (
          <section className="max-w-screen-xl mx-auto px-4 pt-1 pb-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                <Sparkles size={13} className="text-rose-400" /> {totalCards} picks loaded
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                <TrendingUp size={13} className="text-cyan-400" /> Source: {provider}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                <CalendarDays size={13} className="text-amber-400" /> Updated every 15 min
              </span>
            </div>

            <div className="flex gap-2 overflow-x-auto py-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <button
                onClick={clearTopics}
                className={`px-3 py-1.5 rounded-full text-xs border whitespace-nowrap transition-colors ${
                  !isFiltering
                    ? 'bg-rose-600/30 border-rose-500/40 text-rose-200'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                All
              </button>
              {FILTER_CHIPS.map((chip) => {
                const active = activeTopics.includes(chip.key);
                return (
                  <button
                    key={chip.key}
                    onClick={() => toggleTopic(chip.key)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-xs border whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-rose-600/30 border-rose-500/40 text-rose-200'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Continue Watching */}
        <ContinueWatchingRow />

        {/* Sections */}
        <main className="pb-16">
          {loading ? (
            <div className="flex items-center justify-center py-28">
              <Loader2 size={34} className="animate-spin text-rose-500" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
              <span className="text-4xl">⚠️</span><p className="text-sm">{error}</p>
            </div>
          ) : (
            <>
              {visibleSections.map((section) => (
                <Shelf
                  key={section.key}
                  id={section.id}
                  title={section.title}
                  subtitle={section.subtitle}
                  list={getSectionMedia(mergedData, section.key)}
                />
              ))}

              {visibleSections.length === 0 && (
                <section className="max-w-screen-xl mx-auto px-4 pt-6">
                  <div className="rounded-xl border border-white/10 bg-[#12111a] p-6 text-sm text-gray-300">
                    No titles found for the selected topics.
                  </div>
                </section>
              )}

              {!isFiltering && popularGrid.length > 0 && (
                <section className="max-w-screen-xl mx-auto px-4 pt-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy size={16} className="text-amber-400" />
                    <h2 className="text-lg sm:text-xl font-bold text-gray-100">Popular Right Now Grid</h2>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {popularGrid.map((anime) => (
                      <AnimeCard key={`${anime.id || `mal-${anime.idMal}`}-grid`} anime={anime} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-gray-600">
        Metadata from{' '}
        <a href="https://anilist.co" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 transition-colors">AniList</a>
        {' '}· Fallback data from Jikan · Streams from Anitaku · For personal use only
      </footer>
    </div>
  );
}
