'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  RiArrowLeftSLine,
  RiCalendarLine,
  RiClapperboardLine,
  RiLoader4Line,
  RiPlayMiniFill,
  RiSparkling2Fill,
  RiStarFill,
  RiTimeLine,
  RiTv2Line,
} from '@remixicon/react';
import { MediaCard, MetaPill, QuickActionLink, SectionHeading, StatusBadge, SurfacePanel, TagChip } from '@/components/ui';
import { AnimeDetailsSkeleton } from '@/components/skeletons';
import { getWatchSequence, useWatchProgress } from '@/hooks/useWatchProgress';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';
import { fetchAniZipEpisodes } from '@/lib/anizip';
import { fetchJikanAnimeDetails } from '@/lib/jikan';
import { formatRelationType, formatSeason, mediaTitle, stripHtml } from '@/lib/media';
import { animeHref, watchHref } from '@/lib/routes';

const ANIME_DETAILS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      idMal
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large color }
      bannerImage
      episodes
      meanScore
      popularity
      status
      season
      seasonYear
      format
      duration
      genres
      nextAiringEpisode { airingAt episode }
      studios(isMain: true) { nodes { name } }
      relations {
        edges {
          relationType(version: 2)
          node {
            id
            idMal
            type
            format
            title { romaji english }
            coverImage { large extraLarge }
            seasonYear
            status
            episodes
          }
        }
      }
      recommendations(sort: RATING_DESC, perPage: 12) {
        nodes {
          mediaRecommendation {
            id
            idMal
            title { romaji english }
            coverImage { extraLarge large }
            bannerImage
            episodes
            meanScore
            status
            format
            genres
            season
            seasonYear
          }
        }
      }
    }
  }
`;

function SequenceCard({ anime, isCurrent = false, index = 0 }) {
  const title = mediaTitle(anime);
  const relationLabel = formatRelationType(anime.relationType);
  const formatLabel = anime.format ? anime.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={animeHref(anime.id)}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
        isCurrent
          ? 'border-[rgba(183,82,106,0.4)] bg-[rgba(139,40,61,0.16)] text-[var(--color-ivory)]'
          : 'border-white/8 bg-white/5 text-[var(--color-mist)] hover:bg-white/8'
      }`}
    >
      {anime.coverImage?.large ? (
        <img src={anime.coverImage.large} alt={title} className="h-12 w-9 rounded object-cover" loading="lazy" />
      ) : (
        <div className="flex h-12 w-9 items-center justify-center rounded bg-[var(--color-ink)] text-[var(--color-muted)]">
          <RiTv2Line size={14} />
        </div>
      )}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${isCurrent ? 'border-[var(--color-brass)] bg-[rgba(196,160,96,0.14)] text-[var(--color-ivory)]' : 'border-white/10 bg-white/5 text-[var(--color-mist)]'}`}>
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="mt-0.5 flex flex-wrap gap-1.5 text-[0.65rem] uppercase tracking-wider text-[var(--color-muted)]">
          <span>{relationLabel}</span>
          {formatLabel ? <span>• {formatLabel}</span> : null}
          {anime.seasonYear ? <span>• {anime.seasonYear}</span> : null}
          {anime.episodes ? <span>• {anime.episodes} eps</span> : null}
        </div>
      </div>
    </Link>
  );
}

function EpisodeButton({ episode, active, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left transition ${active
          ? 'border-[rgba(183,82,106,0.4)] bg-[rgba(139,40,61,0.16)] text-[var(--color-ivory)]'
          : 'border-white/8 bg-white/5 text-[var(--color-mist)] hover:bg-white/8'
        }`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold opacity-70">
          {loading && active ? <RiLoader4Line size={12} className="animate-spin" /> : `#${episode.mal_id}`}
        </span>
        <span className="truncate text-sm">
          {episode.title || `Episode ${episode.mal_id}`}
        </span>
        {episode.filler ? <span className="ml-auto text-[0.65rem] uppercase tracking-wider text-[var(--color-brass)]">Filler</span> : null}
      </div>
    </button>
  );
}

// Professional cache system for anime details page
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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
    sessionStorage.setItem(key, JSON.stringify({ 
      data, 
      expiry: Date.now() + CACHE_TTL 
    }));
  } catch {}
}

function clearCache(key) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

function AnimeDetailsInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  
  // Initialize from cache for instant load
  const cachedAnime = getCache(`anime-details-${id}`);
  const cachedEpisodes = getCache(`anime-details-episodes-${id}`) || [];
  const [anime, setAnime] = useState(cachedAnime);
  const [episodes, setEpisodes] = useState(cachedEpisodes);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [loading, setLoading] = useState(!cachedAnime); // Only loading if no cached data
  const [error, setError] = useState('');
  const { getProgress } = useWatchProgress();

  useEffect(() => {
    if (!id) return;

    // Check cache first (already done in useState, but ensure for edge cases)
    const cached = getCache(`anime-details-${id}`);
    if (cached && !anime) {
      setAnime(cached);
      setLoading(false);
      return; // Don't refetch if cache is valid
    }
    
    // If we already have data from cache or state, don't refetch
    if (anime) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    setLoading(true);
    setError('');

    anilistRequest(ANIME_DETAILS_QUERY, { id: Number.parseInt(id, 10) }, {
      cacheTtlMs: 5 * 60 * 1000,
      key: `anime-details:${id}`,
    })
      .then((data) => {
        if (cancelled) return;
        if (!data?.Media) {
          throw new Error('Not found in AniList');
        }
        setAnime(data.Media);
        setCache(`anime-details-${id}`, data.Media);
      })
      .catch(async (nextError) => {
        try {
          const fallback = await fetchJikanAnimeDetails(Number.parseInt(id, 10), {
            keyPrefix: `anime-details:jikan:${id}`,
          });
          if (cancelled) return;
          setAnime(fallback);
          setCache(`anime-details-${id}`, fallback);
        } catch {
          if (cancelled) return;
          setError(nextError.message || 'Failed to load anime details');
        }
      })
      .finally(async () => {
        await ensureMinimumDelay(startedAt);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Clear cache when anime changes
  useEffect(() => {
    if (!id) return;
    clearCache(`anime-details-${id}`);
    clearCache(`anime-details-episodes-${id}`);
  }, [id]);

  // Helper function to filter aired episodes (same as player page)
  const filterAiredEpisodes = useCallback((episodeData) => {
    if (!anime?.status || anime.status !== 'RELEASING') return episodeData;
    
    const highestReleasedFromDates = episodeData.reduce(
      (highest, episode) => {
        if (!episode?.airDate) return highest;
        const airDate = new Date(episode.airDate);
        return airDate <= new Date() ? Math.max(highest, episode.mal_id) : highest;
      },
      0,
    );
    const highestReleasedFromAniList = Number(anime?.nextAiringEpisode?.episode) > 1
      ? Number(anime.nextAiringEpisode.episode) - 1
      : 0;
    const highestReleased = Math.max(highestReleasedFromDates, highestReleasedFromAniList);

    if (highestReleased <= 0) return episodeData;
    return episodeData.filter((episode) => episode.mal_id <= highestReleased);
  }, [anime]);

  useEffect(() => {
    if (!anime?.id && !anime?.idMal) return;

    // Check episodes cache first
    const cachedEpisodes = getCache(`anime-details-episodes-${id}`);
    if (cachedEpisodes && cachedEpisodes.length > 0) {
      const airedEpisodes = filterAiredEpisodes(cachedEpisodes);
      setEpisodes(airedEpisodes);
      return; // Don't refetch if cache is valid
    }

    let cancelled = false;
    setEpisodesLoading(true);

    fetchAniZipEpisodes(
      { anilistId: anime.id, malId: anime.idMal },
      {
        cacheTtlMs: 10 * 60 * 1000,
        key: `anime-details-episodes:${anime.id || anime.idMal}`,
      }
    )
      .then((episodeData) => {
        if (cancelled) return;
        const airedEpisodes = filterAiredEpisodes(episodeData);
        setEpisodes(airedEpisodes);
        setCache(`anime-details-episodes-${id}`, airedEpisodes);
      })
      .catch((err) => {
        console.warn('[AnimeDetails] Failed to load episodes:', err);
        if (cancelled) return;
        setEpisodes([]);
      })
      .finally(() => {
        if (cancelled) return;
        setEpisodesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [anime, filterAiredEpisodes, id]);

  const watchSequence = useMemo(() => getWatchSequence(anime, anime?.relations), [anime]);
  const recommendations = useMemo(() => {
    const seen = new Set([anime?.id]);
    return (anime?.recommendations?.nodes || [])
      .map((node) => node?.mediaRecommendation)
      .filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id))
      .slice(0, 12);
  }, [anime]);

  if (!id) {
    return (
      <main className="site-shell flex min-h-screen items-center justify-center px-4">
        <div className="rounded-lg border border-white/8 bg-white/5 px-6 py-5 text-sm text-[var(--color-muted)]">Missing anime id.</div>
      </main>
    );
  }

  if (loading) {
    return <AnimeDetailsSkeleton />;
  }

  if (error || !anime) {
    return (
      <main className="site-shell flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl rounded-lg border border-white/8 bg-white/5 p-6 sm:p-8">
          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Detail Page</p>
          <h1 className="mt-3 font-[family:var(--font-display)] text-3xl text-[var(--color-ivory)] sm:text-4xl">Could not load this anime</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{error || 'Unknown error'}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/" className="button-primary">Go Home</Link>
            <Link href="/search" className="button-secondary">Search Anime</Link>
          </div>
        </div>
      </main>
    );
  }

  const title = mediaTitle(anime);
  const description = stripHtml(anime.description);
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const seasonLabel = formatSeason(anime.season, anime.seasonYear);
  const saved = getProgress(anime.id);
  const resumeTime = Number(saved?.episodePositions?.[saved?.episode] || 0);
  const watchLabel = saved?.episode > 1
    ? `Continue from Episode ${saved.episode}`
    : resumeTime > 0
      ? 'Resume Episode 1'
      : 'Play Now';
  const watchDestination = watchHref(anime.id, { episode: saved?.episode, time: resumeTime });
  const hasBanner = Boolean(anime.bannerImage);
  const heroBackdrop = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || null;

  return (
    <main className="site-shell">
      <section className="relative overflow-hidden border-b border-white/6">
        <div className="absolute inset-0">
          {heroBackdrop ? (
            <div className="relative h-96 overflow-hidden sm:h-[28rem]">
              <div className="absolute inset-0">
                <img
                  src={heroBackdrop}
                  alt={title}
                  className="h-full w-full object-cover"
                  fetchPriority="high"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-obsidian)] via-[var(--color-obsidian)]/60" />
              </div>
            </div>
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(92deg,rgba(8,10,14,0.94)_0%,rgba(8,10,14,0.84)_38%,rgba(8,10,14,0.74)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.35)_0%,rgba(8,10,14,0.72)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(196,160,96,0.18),transparent_28%),radial-gradient(circle_at_85%_15%,rgba(139,40,61,0.28),transparent_30%)]" />
        </div>

        <div className="relative mx-auto max-w-screen-xl px-4 py-6 sm:px-6 sm:py-10">
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Link href="/" className="button-ghost">
              <RiArrowLeftSLine size={18} />
              Home
            </Link>
            <Link href="/search" className="button-secondary">
              <RiSparkling2Fill size={18} />
              Search
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-end lg:gap-8">
            <div className="mx-auto w-full max-w-[15rem] sm:max-w-[19rem] lg:mx-0">
              {anime.coverImage?.extraLarge ? (
                <img
                  src={anime.coverImage.extraLarge}
                  alt={title}
                  className="aspect-[2/3] w-full rounded-[1.5rem] border border-white/10 object-cover shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:rounded-[2rem]"
                />
              ) : null}
            </div>

            <div className="max-w-4xl text-center lg:text-left">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--color-brass)]">Anime Detail</p>
              <h1 className="mt-3 font-[family:var(--font-display)] text-3xl leading-tight text-[var(--color-ivory)] sm:text-5xl lg:text-6xl">
                {title}
              </h1>
              {anime.title?.native ? <p className="mt-3 text-sm text-[var(--color-muted)]">{anime.title.native}</p> : null}

              <div className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
                {score ? <MetaPill icon={RiStarFill} accent="var(--color-brass)">{score}</MetaPill> : null}
                {anime.format ? <MetaPill icon={RiClapperboardLine}>{anime.format.replace(/_/g, ' ')}</MetaPill> : null}
                {anime.episodes ? <MetaPill icon={RiTv2Line}>{anime.episodes} eps</MetaPill> : null}
                {anime.duration ? <MetaPill icon={RiTimeLine}>{anime.duration}m</MetaPill> : null}
                {seasonLabel ? <MetaPill icon={RiCalendarLine}>{seasonLabel}</MetaPill> : null}
                {studio ? <MetaPill icon={RiSparkling2Fill}>{studio}</MetaPill> : null}
                <StatusBadge status={anime.status} />
              </div>

              {description ? (
                <p className="mt-6 max-w-3xl text-sm leading-7 text-[var(--color-mist)] sm:text-base">
                  {description}
                </p>
              ) : null}

              {anime.genres?.length ? (
                <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start">
                  {anime.genres.map((genre) => (
                    <TagChip key={genre}>{genre}</TagChip>
                  ))}
                </div>
              ) : null}

              <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3 lg:justify-start">
                <QuickActionLink href={watchDestination} primary icon={RiPlayMiniFill}>
                  {watchLabel}
                </QuickActionLink>
                <QuickActionLink href={`/search?q=${encodeURIComponent(title)}`} icon={RiSparkling2Fill}>
                  Explore Similar
                </QuickActionLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-screen-xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        {episodes.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ivory)]">Episodes</h2>
            {episodesLoading ? (
              <div className="max-h-[20rem] space-y-1.5 overflow-y-auto pr-1">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div key={index} className="w-full rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-6 rounded bg-white/10" />
                      <div className="h-3 w-24 rounded bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-[20rem] space-y-1.5 overflow-y-auto pr-1">
                {episodes.map((episode) => {
                  const saved = getProgress(anime.id);
                  const isCurrent = saved?.episode === episode.mal_id;
                  
                  return (
                    <Link key={episode.mal_id} href={watchHref(anime.id, { episode: episode.mal_id })}>
                      <EpisodeButton
                        episode={episode}
                        active={isCurrent}
                        loading={false}
                        onClick={(e) => {
                          e.preventDefault();
                          window.location.href = watchHref(anime.id, { episode: episode.mal_id });
                        }}
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {watchSequence.length > 1 ? (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ivory)]">Seasons</h2>
            <div className="max-h-[30rem] space-y-1.5 overflow-y-auto pr-1">
              {watchSequence.map((item, index) => (
                <SequenceCard key={item.id} anime={item} isCurrent={item.id === anime.id} index={index} />
              ))}
            </div>
          </div>
        ) : null}

        {recommendations.length ? (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ivory)]">Recommendations</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {recommendations.map((item) => (
                <MediaCard key={item.id} anime={item} compact />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default function AnimeDetailsPage() {
  return (
    <Suspense
      fallback={
        <AnimeDetailsSkeleton />
      }
    >
      <AnimeDetailsInner />
    </Suspense>
  );
}
