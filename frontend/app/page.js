'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiFireFill,
  RiPlayMiniFill,
  RiSearchLine,
  RiSparkling2Fill,
  RiTrophyLine,
  RiTv2Line,
} from '@remixicon/react';
import {
  ContinueBadge,
  HeroMetaRow,
  MediaCard,
  MetaPill,
  QuickActionLink,
  SearchField,
  SectionHeading,
  SurfacePanel,
  TagChip,
  TopNav,
  UiIcons,
  cx,
} from '@/components/ui';
import { ContinueRowSkeleton, HomePageSkeleton, MediaGridSkeleton, ShelfSkeleton, SkeletonBlock } from '@/components/skeletons';
import { useLazyMount } from '@/hooks/useLazyMount';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';
import { mediaTitle } from '@/lib/media';
import { pacedJsonFetch } from '@/lib/requestScheduler';
import { animeHref, watchHref } from '@/lib/routes';

const CRITICAL_CACHE_KEY = 'home_critical_v2';
const SECONDARY_CACHE_KEY = 'home_secondary_v2';
const HOME_CACHE_TTL_MS = 15 * 60 * 1000;

function getCache(key) {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const { data, expiry } = JSON.parse(stored);
    if (Date.now() > expiry) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + HOME_CACHE_TTL_MS }));
  } catch {}
}

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
      medium: item.images?.jpg?.image_url || item.images?.jpg?.large_image_url || null,
    },
    episodes: item.episodes || null,
    meanScore: item.score ? Math.round(item.score * 10) : null,
    genres: Array.isArray(item.genres) ? item.genres.map((genre) => genre.name).filter(Boolean) : [],
    status: item.status === 'Currently Airing' ? 'RELEASING' : String(item.status || '').toUpperCase().replace(/\s+/g, '_'),
    format: item.type ? String(item.type).toUpperCase().replace(/\s+/g, '_') : null,
    nextAiringEpisode: null,
    bannerImage: null,
  };
}

function mediaHref(media) {
  if (media?.id) return animeHref(media.id);
  const title = mediaTitle(media);
  return title ? `/search?q=${encodeURIComponent(title)}` : '/';
}

function mediaIdentity(media, index = 0) {
  if (media?.id != null) return `id-${media.id}`;
  if (media?.idMal != null) return `mal-${media.idMal}`;

  const normalizedTitle = mediaTitle(media).trim().toLowerCase();
  if (normalizedTitle) return `title-${normalizedTitle}`;
  return `idx-${index}`;
}

async function fetchJikanList(url) {
  const payload = await pacedJsonFetch(url, undefined, {
    key: `jikan:${url}`,
    cacheTtlMs: 10 * 60 * 1000,
  });
  return Array.isArray(payload?.data) ? payload.data.map(normalizeJikanAnime).filter(Boolean) : [];
}

async function fetchJikanFallbackHome() {
  const [top, airing, popular, seasonNow] = await Promise.allSettled([
    fetchJikanList('https://api.jikan.moe/v4/top/anime?limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/top/anime?filter=airing&limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=24'),
    fetchJikanList('https://api.jikan.moe/v4/seasons/now?limit=24'),
  ]);

  const get = (result) => (result.status === 'fulfilled' ? result.value : []);
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
    movies: { media: topList.filter((media) => media.format === 'MOVIE') },
    action: { media: seasonList.filter((media) => media.genres?.includes('Action')) },
    romance: { media: seasonList.filter((media) => media.genres?.includes('Romance')) },
    fantasy: { media: seasonList.filter((media) => media.genres?.includes('Fantasy')) },
    comedy: { media: seasonList.filter((media) => media.genres?.includes('Comedy')) },
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

function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    function handler(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (term) => {
    if (!term.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setOpen(true);
    try {
      const data = await anilistRequest(SUGGEST_QUERY, { s: term }, {
        cacheTtlMs: 45 * 1000,
        key: `home:suggest:${term.trim().toLowerCase()}`,
      });
      const media = (data?.Page?.media || []).filter((item) => item.id || item.idMal);
      setResults(media);
      setOpen(media.length > 0 || term.trim().length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchSuggestions(value), 420);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const clear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative mx-auto max-w-2xl">
      <SearchField
        value={query}
        onChange={handleChange}
        onSubmit={handleSubmit}
        onClear={clear}
        loading={loading}
        placeholder="Search by title, genre, or season..."
      />

      {open && (loading || results.length > 0) ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-3 max-h-[min(22rem,calc(100vh-8rem))] overflow-y-auto overflow-x-hidden rounded-[1.35rem] border border-white/8 bg-[rgba(8,10,14,0.96)] shadow-[0_24px_70px_rgba(0,0,0,0.4)] backdrop-blur-2xl sm:rounded-[1.6rem]">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="border-b border-white/6 px-4 py-3 last:border-b-0">
                <div className="flex items-center gap-3 sm:gap-4">
                  <SkeletonBlock className="block h-14 w-10 shrink-0" borderRadius={12} />
                  <div className="min-w-0 flex-1">
                    <SkeletonBlock className="mb-2 block max-w-[12rem]" height={14} />
                    <SkeletonBlock className="block max-w-[9rem]" height={10} />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <>
              {results.map((anime) => {
                const title = mediaTitle(anime);
                const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;

                return (
                  <Link
                    key={anime.id || anime.idMal}
                    href={mediaHref(anime)}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex items-center gap-3 border-b border-white/6 px-4 py-3 last:border-b-0 hover:bg-white/5 sm:gap-4"
                  >
                    {anime.coverImage?.medium ? (
                      <img src={anime.coverImage.medium} alt={title} className="h-14 w-10 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-14 w-10 items-center justify-center rounded-xl bg-[var(--color-ink)] text-[var(--color-muted)]">
                        <UiIcons.tv size={18} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-ivory)]">{title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                        {score ? <span className="inline-flex items-center gap-1 text-[var(--color-brass)]"><UiIcons.star size={12} />{score}</span> : null}
                        {anime.episodes ? <span>{anime.episodes} eps</span> : null}
                        {anime.status ? <span>{anime.status === 'RELEASING' ? 'Airing' : anime.status}</span> : null}
                      </div>
                    </div>
                    <UiIcons.arrowRight size={18} className="text-[var(--color-muted)]" />
                  </Link>
                );
              })}
            </>
          )}
          <button
            onClick={handleSubmit}
            className="flex w-full items-center justify-between px-4 py-3 text-sm text-[var(--color-mist)] hover:bg-white/5"
          >
            <span>See all results for “{query}”</span>
            <UiIcons.arrowRight size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContinueCard({ data }) {
  const progress = data.totalEpisodes
    ? Math.min(100, Math.max(0, (data.episode / data.totalEpisodes) * 100))
    : 0;

  return (
    <Link href={watchHref(data.seasonId)} className="media-card group overflow-hidden">
      <div className="media-card-art">
        {data.coverImage ? (
          <img src={data.coverImage} alt={data.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--color-ink)] text-[var(--color-muted)]">
            <UiIcons.tv size={32} />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.06),rgba(8,10,14,0.88))]" />
        <div className="absolute left-3 top-3">
          <ContinueBadge>Resume</ContinueBadge>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="mb-2 flex items-center justify-between text-[0.68rem] uppercase tracking-[0.16em] text-[var(--color-mist)]">
            <span>Episode {data.episode}</span>
            <span>{data.totalEpisodes || '?'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-brass),var(--color-wine-bright))]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 text-base font-medium leading-6 text-[var(--color-ivory)]">{data.title}</h3>
      </div>
    </Link>
  );
}

function ContinueWatchingRow() {
  const { items, loading } = useContinueWatching(6);
  const railRef = useRef(null);

  const scrollRail = useCallback((direction) => {
    const element = railRef.current;
    if (!element) return;
    const amount = Math.max(260, Math.floor(element.clientWidth * 0.92));
    element.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  if (loading) return <ContinueRowSkeleton />;
  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-screen-xl px-4 pt-6 sm:px-6">
      <SurfacePanel className="overflow-hidden p-5 sm:p-6">
        <SectionHeading
          eyebrow="Your Progress"
          title="Continue watching"
          subtitle="Quick return cards for unfinished episodes and saved resume points."
          action={<Link href="/continue-watching" className="button-secondary">View All</Link>}
        />
        <div className="relative mt-5 sm:mt-6">
          <button
            aria-label="Scroll continue watching left"
            onClick={() => scrollRail(-1)}
            className="button-ghost absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/10 bg-[rgba(8,10,14,0.62)] px-3 lg:inline-flex"
          >
            <RiArrowLeftSLine size={18} />
          </button>
          <button
            aria-label="Scroll continue watching right"
            onClick={() => scrollRail(1)}
            className="button-ghost absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/10 bg-[rgba(8,10,14,0.62)] px-3 lg:inline-flex"
          >
            <RiArrowRightSLine size={18} />
          </button>
          <div ref={railRef} className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 sm:gap-4">
            {items.map((item) => (
              <div key={`${item.id}-${item.episode}`} className="rail-card">
                <ContinueCard data={item} />
              </div>
            ))}
          </div>
        </div>
      </SurfacePanel>
    </section>
  );
}

function HeroSpotlight({ list }) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (list.length <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % list.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [list.length]);

  if (!list.length) return null;

  const active = list[activeIndex];
  const backdrop = active.bannerImage || active.coverImage?.extraLarge || active.coverImage?.large;
  const title = mediaTitle(active);

  return (
    <section className="mx-auto max-w-screen-xl px-4 pt-7 sm:px-6 sm:pt-8">
      <SurfacePanel className="relative overflow-hidden px-0 py-0">
        <div className="relative min-h-[28rem] overflow-hidden rounded-[1.35rem] sm:min-h-[34rem] sm:rounded-[1.75rem]">
          {backdrop ? <img src={backdrop} alt={title} className="absolute inset-0 h-full w-full object-cover" /> : null}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,10,14,0.92)_0%,rgba(8,10,14,0.72)_46%,rgba(8,10,14,0.45)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_16%,rgba(196,160,96,0.14),transparent_24%),radial-gradient(circle_at_80%_18%,rgba(139,40,61,0.18),transparent_26%)]" />

          <div className="relative grid min-h-[28rem] gap-5 p-4 sm:min-h-[34rem] sm:gap-6 sm:p-8 lg:p-10">
            <div className="flex max-w-3xl flex-col justify-end">
              <div className="mb-3 inline-flex items-center gap-2 text-[0.66rem] uppercase tracking-[0.18em] text-[var(--color-brass)] sm:mb-4 sm:text-[0.72rem] sm:tracking-[0.22em]">
                <RiFireFill size={15} />
                Featured Tonight
              </div>
              <h1 className="max-w-3xl font-[family:var(--font-display)] text-3xl leading-[1.05] text-[var(--color-ivory)] sm:text-5xl lg:text-6xl">
                {title}
              </h1>
              <div className="mt-4 sm:mt-5">
                <HeroMetaRow anime={active} />
              </div>
              {(active?.genres?.length > 0 || active?.season || active?.nextAiringEpisode) && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {active.season && active.seasonYear && (
                    <MetaPill icon={RiCalendarLine}>
                      {active.season.charAt(0) + active.season.slice(1).toLowerCase()} {active.seasonYear}
                    </MetaPill>
                  )}
                  {active.nextAiringEpisode?.episode && (
                    <MetaPill icon={RiTv2Line} accent="var(--color-brass)">
                      Next: EP {active.nextAiringEpisode.episode}
                    </MetaPill>
                  )}
                  {(active.genres || []).slice(0, 4).map((genre) => (
                    <TagChip key={genre}>{genre}</TagChip>
                  ))}
                </div>
              )}
              <div className="mt-6 flex flex-col gap-2.5 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3">
                <QuickActionLink href={mediaHref(active)} primary icon={RiPlayMiniFill}>
                  View Details
                </QuickActionLink>
                <QuickActionLink href={`/search?q=${encodeURIComponent(title)}`} icon={RiSearchLine}>
                  Explore Similar
                </QuickActionLink>
              </div>
            </div>


          </div>
        </div>
      </SurfacePanel>
    </section>
  );
}

function Shelf({ id, title, subtitle, list }) {
  const railRef = useRef(null);

  const scrollRail = useCallback((direction) => {
    const element = railRef.current;
    if (!element) return;
    const amount = Math.max(260, Math.floor(element.clientWidth * 0.92));
    element.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  if (!list.length) return null;

  return (
    <section id={id} className="mx-auto max-w-screen-xl px-4 py-5 sm:px-6">
      <SurfacePanel className="overflow-hidden p-5 sm:p-6">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="relative mt-5 sm:mt-6">
          <button
            aria-label={`Scroll ${title} left`}
            onClick={() => scrollRail(-1)}
            className="button-ghost absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/10 bg-[rgba(8,10,14,0.62)] px-3 lg:inline-flex"
          >
            <RiArrowLeftSLine size={18} />
          </button>
          <button
            aria-label={`Scroll ${title} right`}
            onClick={() => scrollRail(1)}
            className="button-ghost absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-white/10 bg-[rgba(8,10,14,0.62)] px-3 lg:inline-flex"
          >
            <RiArrowRightSLine size={18} />
          </button>
          <div ref={railRef} className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 sm:gap-4">
            {list.map((anime) => (
              <div key={`${anime.id || `mal-${anime.idMal}`}-${title}`} className="rail-card">
                <MediaCard anime={anime} href={mediaHref(anime)} compact />
              </div>
            ))}
          </div>
        </div>
      </SurfacePanel>
    </section>
  );
}

const SECTION_META = [
  { key: 'airing', id: 'airing', title: 'Airing Right Now', subtitle: 'Episodes currently releasing this season' },
  { key: 'trending', id: 'trending', title: 'Trending This Week', subtitle: 'The titles generating the strongest momentum right now' },
  { key: 'topRated', id: 'top-rated', title: 'Top Rated Legends', subtitle: 'Audience favourites with standout scores' },
  { key: 'movies', id: 'movies', title: 'Anime Movies', subtitle: 'Big-screen stories with premium visual impact' },
  { key: 'action', id: 'action', title: 'Action Pulse', subtitle: 'Fast, kinetic, high-energy picks' },
  { key: 'romance', id: 'romance', title: 'Romance & Feels', subtitle: 'Heart-forward picks with chemistry and drama' },
  { key: 'fantasy', id: 'fantasy', title: 'Fantasy Worlds', subtitle: 'Alternate worlds, myths, and magical systems' },
  { key: 'comedy', id: 'comedy', title: 'Comedy Break', subtitle: 'Lighter shows when you want to decompress' },
  { key: 'upcoming', id: 'upcoming', title: 'Coming Soon', subtitle: 'Anticipated titles not yet released' },
  { key: 'popular', id: 'popular', title: 'All-Time Popular', subtitle: 'Evergreen anime with broad appeal' },
];

const FILTER_CHIPS = [
  { key: 'airing', label: 'Airing Now' },
  { key: 'topRated', label: 'Top Rated' },
  { key: 'movies', label: 'Movies' },
  { key: 'action', label: 'Action' },
  { key: 'romance', label: 'Romance' },
  { key: 'upcoming', label: 'Upcoming' },
];

const CRITICAL_SECTION_KEYS = new Set(['airing', 'trending']);
const SECONDARY_SECTION_KEYS = new Set(SECTION_META.map((section) => section.key).filter((key) => !CRITICAL_SECTION_KEYS.has(key)));

function LazyShelfSection({ section, list, ready, loading, hasLoaded, onVisible }) {
  const { ref, isVisible } = useLazyMount();

  useEffect(() => {
    if (isVisible) onVisible();
  }, [isVisible, onVisible]);

  if (hasLoaded && !ready && !loading && list.length === 0) {
    return <div ref={ref} />;
  }

  return (
    <div ref={ref}>
      {ready ? (
        <Shelf id={section.id} title={section.title} subtitle={section.subtitle} list={list} />
      ) : (
        <ShelfSkeleton title={section.title} subtitle={section.subtitle} cardCount={loading ? 5 : 4} />
      )}
    </div>
  );
}

export default function HomePage() {
  const [data, setData] = useState(null);
  const [secondary, setSecondary] = useState(null);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('AniList');
  const [activeTopics, setActiveTopics] = useState([]);

  const mergedData = useMemo(() => {
    if (!data) return null;
    return { ...data, ...(secondary || {}) };
  }, [data, secondary]);

  const toggleTopic = useCallback((topicKey) => {
    setActiveTopics((previous) => (
      previous.includes(topicKey)
        ? previous.filter((key) => key !== topicKey)
        : [...previous, topicKey]
    ));
  }, []);

  const clearTopics = useCallback(() => setActiveTopics([]), []);

  const loadSecondary = useCallback(async () => {
    if (secondary || secondaryLoading) return;

    setSecondaryLoading(true);
    try {
      const payload = await anilistRequest(SECONDARY_QUERY, {}, {
        cacheTtlMs: HOME_CACHE_TTL_MS,
        key: 'home:secondary',
      });
      setSecondary(payload);
      setCache(SECONDARY_CACHE_KEY, payload);
    } catch (secondaryError) {
      console.warn('[Home] Secondary fetch failed:', secondaryError.message);
    } finally {
      setSecondaryLoading(false);
    }
  }, [secondary, secondaryLoading]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    (async () => {
      const cachedCritical = getCache(CRITICAL_CACHE_KEY);
      const cachedSecondary = getCache(SECONDARY_CACHE_KEY);

      if (cachedCritical && !cancelled) {
        setData({ ...cachedCritical, provider: cachedCritical.provider || 'anilist' });
        setProvider(cachedCritical.provider === 'jikan' ? 'Jikan Fallback' : 'AniList');
      }

      if (cachedSecondary && !cancelled) {
        setSecondary(cachedSecondary);
      }

      if (!cachedCritical) {
        try {
          const primary = await anilistRequest(CRITICAL_QUERY, {}, {
            cacheTtlMs: HOME_CACHE_TTL_MS,
            key: 'home:critical',
          });
          const payload = { ...primary, provider: 'anilist' };
          if (!cancelled) {
            setData(payload);
            setProvider('AniList');
          }
          setCache(CRITICAL_CACHE_KEY, payload);
        } catch (criticalError) {
          console.warn('[Home] AniList critical failed, trying Jikan:', criticalError.message);
          try {
            const fallback = await fetchJikanFallbackHome();
            if (!cancelled) {
              setData(fallback);
              setProvider('Jikan Fallback');
            }
            setCache(CRITICAL_CACHE_KEY, fallback);
          } catch (fallbackError) {
            if (!cancelled) setError(fallbackError.message || 'Failed to load homepage');
          }
        }
      }

      await ensureMinimumDelay(startedAt);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeTopics.some((key) => SECONDARY_SECTION_KEYS.has(key))) return;
    loadSecondary();
  }, [activeTopics, loadSecondary]);

  const featuredList = useMemo(() => {
    const rankWeights = { airing: 28, trending: 22, topRated: 18, popular: 10 };
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

      return baseScore + (rankWeights[source] || 0) + (hasBackdrop ? 16 : 0) + (isAiring ? 12 : 0) + (hasGenres ? 4 : 0);
    };

    const bestById = new Map();
    for (const { anime, source } of scoredPools) {
      const key = String(anime?.id || anime?.idMal || '');
      if (!key) continue;
      const nextScore = scoreEntry(anime, source);
      const existing = bestById.get(key);
      if (!existing || nextScore > existing.score) bestById.set(key, { anime, score: nextScore });
    }

    return Array.from(bestById.values())
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.anime)
      .slice(0, 6);
  }, [mergedData]);

  const popularGrid = getSectionMedia(mergedData, 'popular').slice(0, 12);
  const totalCards = SECTION_META.reduce((count, section) => count + getSectionMedia(mergedData, section.key).length, 0);
  const visibleSections = useMemo(() => {
    if (!activeTopics.length) return SECTION_META;
    const selected = new Set(activeTopics);
    return SECTION_META.filter((section) => selected.has(section.key));
  }, [activeTopics]);
  const criticalSections = useMemo(
    () => visibleSections.filter((section) => CRITICAL_SECTION_KEYS.has(section.key)),
    [visibleSections]
  );
  const deferredSections = useMemo(
    () => visibleSections.filter((section) => SECONDARY_SECTION_KEYS.has(section.key)),
    [visibleSections]
  );
  const isFiltering = activeTopics.length > 0;

  return (
    <main className="site-shell">
      <TopNav
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Ad-Free Fast Streams</span>}
      >
        <SearchBar />
      </TopNav>

      {loading ? (
        <HomePageSkeleton />
      ) : error ? (
        <section className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6">
          <SurfacePanel className="p-6 sm:p-8">
            <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Homepage Error</p>
            <h1 className="mt-3 font-[family:var(--font-display)] text-3xl text-[var(--color-ivory)] sm:text-4xl">We couldn’t load the homepage.</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{error}</p>
          </SurfacePanel>
        </section>
      ) : (
        <>
          <HeroSpotlight list={featuredList} />

          <section className="mx-auto max-w-screen-xl px-4 pt-6 sm:px-6">
            <SurfacePanel className="overflow-hidden p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <SectionHeading
                  eyebrow="Editorial Discovery"
                  title="A premium anime front page"
                  subtitle="A curated blend of trending, airing, high-score, and genre-led shelves backed by AniList and resilient fallback data."
                />
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <MetaPill icon={RiSparkling2Fill} accent="var(--color-brass)">{totalCards} picks loaded</MetaPill>
                  <MetaPill icon={RiTrophyLine}>Source: {provider}</MetaPill>
                  <MetaPill icon={RiCalendarLine}>Refreshes every 15 min</MetaPill>
                </div>
              </div>

              <div className="hide-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1 sm:mt-6">
                <button
                  onClick={clearTopics}
                  className={cx('tag-chip whitespace-nowrap', !isFiltering ? '!border-[rgba(196,160,96,0.32)] !bg-[rgba(196,160,96,0.14)] !text-[var(--color-brass)]' : '')}
                >
                  All Collections
                </button>
                {FILTER_CHIPS.map((chip) => {
                  const active = activeTopics.includes(chip.key);
                  return (
                    <button
                      key={chip.key}
                      onClick={() => toggleTopic(chip.key)}
                      aria-pressed={active}
                      className={cx('tag-chip whitespace-nowrap', active ? '!border-[rgba(183,82,106,0.42)] !bg-[rgba(139,40,61,0.18)] !text-[var(--color-ivory)]' : '')}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </SurfacePanel>
          </section>

          <ContinueWatchingRow />

          {criticalSections.map((section) => (
            <Shelf
              key={section.key}
              id={section.id}
              title={section.title}
              subtitle={section.subtitle}
              list={getSectionMedia(mergedData, section.key)}
            />
          ))}

          {deferredSections.map((section) => {
            const list = getSectionMedia(mergedData, section.key);
            const ready = Boolean(secondary) && list.length > 0;

            return (
              <LazyShelfSection
                key={section.key}
                section={section}
                list={list}
                ready={ready}
                loading={secondaryLoading}
                hasLoaded={Boolean(secondary)}
                onVisible={loadSecondary}
              />
            );
          })}

          {!isFiltering && (secondaryLoading || popularGrid.length > 0 || !secondary) ? (
            <section className="mx-auto max-w-screen-xl px-4 py-5 sm:px-6">
              <SurfacePanel className="overflow-hidden p-5 sm:p-6">
                <SectionHeading
                  eyebrow="Signature Grid"
                  title="Popular right now"
                  subtitle="A broader grid for quick browsing once the curated rails have set the tone."
                />
                {secondary ? (
                  <div className="mt-6 grid grid-cols-1 gap-4 min-[430px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {popularGrid.map((anime) => (
                      <MediaCard key={`${anime.id || `mal-${anime.idMal}`}-grid`} anime={anime} href={mediaHref(anime)} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-6" onMouseEnter={loadSecondary}>
                    <MediaGridSkeleton count={4} className="min-[430px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
                  </div>
                )}
              </SurfacePanel>
            </section>
          ) : null}

          {visibleSections.length === 0 ? (
            <section className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
              <SurfacePanel className="p-8 text-sm text-[var(--color-muted)]">
                No titles found for the selected topics.
              </SurfacePanel>
            </section>
          ) : null}
        </>
      )}

      <footer className="mx-auto max-w-screen-xl px-4 pb-8 pt-10 text-center text-xs uppercase tracking-[0.16em] text-[var(--color-muted)] sm:px-6">
        Metadata from <a href="https://anilist.co" target="_blank" rel="noopener noreferrer" className="text-[var(--color-mist)]">AniList</a>
        {' '}and fallback data from Jikan. Streams resolve through Anitaku for personal use.
      </footer>
    </main>
  );
}
