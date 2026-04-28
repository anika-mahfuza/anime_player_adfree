'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  RiAlertLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiClapperboardLine,
  RiHistoryLine,
  RiListCheck3,
  RiLoader4Line,
  RiPlayMiniFill,
  RiSparkling2Fill,
  RiStarFill,
  RiTimeLine,
  RiTv2Line,
} from '@remixicon/react';
import AnimePlayer from '@/components/AnimePlayer';
import { WatchPageSkeleton } from '@/components/skeletons';
import { MetaPill, SectionHeading, StatusBadge, SurfacePanel, TagChip, TopNav } from '@/components/ui';
import { getWatchSequence, useWatchProgress } from '@/hooks/useWatchProgress';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';
import { fetchAniZipEpisodes } from '@/lib/anizip';
import { apiUrl } from '@/lib/apiBase';
import { fetchJikanAnimeDetails, jikanRequest } from '@/lib/jikan';
import { formatRelationType, formatSeason, mediaTitle, stripHtml } from '@/lib/media';
import { pacedJsonFetch } from '@/lib/requestScheduler';
import { animeHref } from '@/lib/routes';

const ANIME_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id idMal
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large color }
      bannerImage
      episodes meanScore popularity status season seasonYear format
      duration studios(isMain: true) { nodes { name } }
      genres tags { name rank }
      nextAiringEpisode { airingAt episode }
      relations {
        edges {
          relationType(version: 2)
          node {
            id idMal type format
            title { romaji english }
            coverImage { large }
            seasonYear status episodes
          }
        }
      }
    }
  }
`;

async function fetchEpisodes(malId) {
  const baseKey = `episodes:${malId}`;
  const first = await jikanRequest(`/anime/${malId}/episodes`, { page: 1 }, {
    key: `${baseKey}:1`,
    cacheTtlMs: 10 * 60 * 1000,
  });

  if (!first.data) return [];

  const last = first.pagination?.last_visible_page ?? 1;
  if (last === 1) return first.data;

  const pages = [first.data];
  for (let page = 2; page <= last; page += 1) {
    const payload = await jikanRequest(`/anime/${malId}/episodes`, { page }, {
      key: `${baseKey}:${page}`,
      cacheTtlMs: 10 * 60 * 1000,
    });
    pages.push(payload.data ?? []);
  }

  return pages.flat();
}

function buildFallbackEpisodes(count) {
  return Array.from(
    { length: Math.max(1, count) },
    (_, index) => ({
      mal_id: index + 1,
      number: index + 1,
      title: null,
      filler: false,
    }),
  );
}

function mergeEpisodesWithFallback(episodeData, minimumCount) {
  const normalized = Array.isArray(episodeData) ? episodeData.filter(Boolean) : [];
  const mapped = new Map(
    normalized
      .map((episode) => {
        const number = Number.parseInt(String(episode?.mal_id ?? episode?.number), 10);
        if (!Number.isFinite(number) || number <= 0) return null;

        return [
          number,
          {
            ...episode,
            mal_id: number,
            number,
            filler: Boolean(episode?.filler),
          },
        ];
      })
      .filter(Boolean),
  );

  const highestEpisode = Math.max(
    minimumCount,
    ...Array.from(mapped.keys()),
    1,
  );

  return Array.from({ length: highestEpisode }, (_, index) => {
    const number = index + 1;
    return mapped.get(number) || {
      mal_id: number,
      number,
      title: null,
      filler: false,
    };
  });
}

function isReleasedEpisode(episode) {
  const airDate = episode?.airDate ? Date.parse(episode.airDate) : Number.NaN;
  return Number.isFinite(airDate) ? airDate <= Date.now() : false;
}

function limitEpisodesForMedia(episodeData, media) {
  const normalized = Array.isArray(episodeData) ? episodeData.filter(Boolean) : [];
  if (!normalized.length) return normalized;
  if (media?.status !== 'RELEASING') return normalized;

  const highestReleasedFromDates = normalized.reduce(
    (highest, episode) => (isReleasedEpisode(episode) ? Math.max(highest, episode.mal_id) : highest),
    0,
  );
  const highestReleasedFromAniList = Number(media?.nextAiringEpisode?.episode) > 1
    ? Number(media.nextAiringEpisode.episode) - 1
    : 0;
  const highestReleased = Math.max(highestReleasedFromDates, highestReleasedFromAniList);

  if (highestReleased <= 0) return [];
  return normalized.filter((episode) => episode.mal_id <= highestReleased);
}

function getInitialEpisodeLimit(media) {
  if (media?.status === 'RELEASING' && Number(media?.nextAiringEpisode?.episode) > 1) {
    return Math.max(1, Number(media.nextAiringEpisode.episode) - 1);
  }

  return Math.max(1, Number(media?.episodes) || 1);
}

async function fetchPreferredEpisodes({ anilistId, malId, fallbackCount, media }) {
  try {
    const aniZipEpisodes = await fetchAniZipEpisodes({ malId, anilistId }, {
      key: `watch-episodes:anizip:${malId || 'x'}:${anilistId || 'x'}`,
      cacheTtlMs: 2 * 60 * 1000,
    });

    if (aniZipEpisodes.length) {
      return limitEpisodesForMedia(mergeEpisodesWithFallback(aniZipEpisodes, fallbackCount), media);
    }
  } catch (error) {
    console.warn('[Watch] AniZip episode fetch failed, trying Jikan:', error.message);
  }

  if (malId) {
    try {
      const jikanEpisodes = await fetchEpisodes(malId);
      if (jikanEpisodes.length) {
        return limitEpisodesForMedia(mergeEpisodesWithFallback(jikanEpisodes, fallbackCount), media);
      }
    } catch (error) {
      console.warn('[Watch] Jikan episode fetch failed, using fallback episode list:', error.message);
    }
  }

  return limitEpisodesForMedia(buildFallbackEpisodes(fallbackCount), media);
}

async function fetchStreamUrl({
  titles,
  episode,
  year,
  format,
  totalEpisodes,
  duration,
}) {
  const [primaryTitle, ...restTitles] = titles;
  const altTitles = restTitles.join('|');
  const query = new URLSearchParams({
    title: primaryTitle,
    episode: String(episode),
  });
  if (altTitles) query.set('altTitles', altTitles);
  if (year) query.set('year', String(year));
  if (format) query.set('format', format);
  if (totalEpisodes) query.set('totalEpisodes', String(totalEpisodes));
  if (duration) query.set('duration', String(duration));

  const payload = await pacedJsonFetch(apiUrl(`/api/stream?${query.toString()}`), undefined, {
    key: `stream:${query.toString()}`,
    cacheTtlMs: 20 * 1000,
  });
  if (payload.error) throw new Error(payload.error ?? 'Stream fetch failed');
  return payload.streamUrl;
}

async function fetchSkipTimes(malId, episode, language = 'sub') {
  const normalizedMalId = Number.parseInt(String(malId || ''), 10);
  const normalizedEpisode = Number.parseInt(String(episode || ''), 10);
  if (!Number.isFinite(normalizedMalId) || normalizedMalId <= 0) return null;
  if (!Number.isFinite(normalizedEpisode) || normalizedEpisode <= 0) return null;

  const query = new URLSearchParams({
    malId: String(normalizedMalId),
    episode: String(normalizedEpisode),
    lang: language === 'dub' ? 'dub' : 'sub',
  });

  const payload = await pacedJsonFetch(apiUrl(`/api/skip-times?${query.toString()}`), undefined, {
    key: `skip-times:${query.toString()}`,
    cacheTtlMs: 30 * 60 * 1000,
  });

  return payload?.skipTimes || null;
}

function EpisodeButton({ episode, active, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[1.15rem] border px-4 py-3 text-left transition ${active
          ? 'border-[rgba(183,82,106,0.4)] bg-[rgba(139,40,61,0.16)] text-[var(--color-ivory)]'
          : 'border-white/8 bg-white/5 text-[var(--color-mist)] hover:bg-white/8'
        }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[rgba(8,10,14,0.45)] text-sm font-semibold">
          {loading && active ? <RiLoader4Line size={15} className="animate-spin" /> : episode.mal_id}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{episode.title || `Episode ${episode.mal_id}`}</p>
          {episode.filler ? <p className="mt-1 text-[0.68rem] uppercase tracking-[0.14em] text-[var(--color-brass)]">Filler</p> : null}
        </div>
        {active ? <RiPlayMiniFill size={18} className="text-[var(--color-brass)]" /> : null}
      </div>
    </button>
  );
}

function SeasonCard({ season, isCurrent }) {
  const title = mediaTitle(season);
  const formatLabel = season.format ? season.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={animeHref(season.id)}
      className={`surface-panel flex items-center gap-3 p-3 ${isCurrent ? '!border-2 !border-[var(--color-brass)] shadow-[0_0_0_1px_rgba(196,160,96,0.2)]' : ''}`}
    >
      {season.coverImage?.large ? (
        <img src={season.coverImage.large} alt={title} className="h-16 w-12 rounded-[0.95rem] object-cover" loading="lazy" />
      ) : (
        <div className="flex h-16 w-12 items-center justify-center rounded-[0.95rem] bg-[var(--color-ink)] text-[var(--color-muted)]">
          <RiTv2Line size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-ivory)]">{title}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-[0.66rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
          <span>{formatRelationType(season.relationType)}</span>
          {formatLabel ? <span>{formatLabel}</span> : null}
          {season.seasonYear ? <span>{season.seasonYear}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <WatchPageSkeleton />
      }
    >
      <WatchPageContent />
    </Suspense>
  );
}

function WatchPageContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const requestedEpisode = Math.max(0, Number.parseInt(searchParams.get('ep') || '', 10) || 0);
  const requestedTime = Math.max(0, Number.parseInt(searchParams.get('t') || '', 10) || 0);

  const [anime, setAnime] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [activeEpisode, setActiveEpisode] = useState(1);
  const [streamUrl, setStreamUrl] = useState('');
  const [metaLoading, setMetaLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [skipTimes, setSkipTimes] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [videoDurationSec, setVideoDurationSec] = useState(null);

  const episodeRefs = useRef({});
  const { updateProgress, getProgress } = useWatchProgress();
  const isMounted = useRef(true);
  const restoreReadyRef = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const startedAt = Date.now();
    restoreReadyRef.current = false;
    setMetaLoading(true);
    setAnime(null);
    setEpisodes([]);
    setActiveEpisode(1);
    setHasStarted(false);
    setStreamUrl('');
    setStreamError('');

    const anilistId = Number.parseInt(id, 10);

    const applyMedia = (media) => {
      if (!isMounted.current || !media) return;

      const saved = getProgress(media.id);
      const preferredEpisode = requestedEpisode > 0
        ? requestedEpisode
        : Number(saved?.episode) || 1;
      const maxEpisode = getInitialEpisodeLimit(media);
      const initialEpisode = Math.max(1, Math.min(preferredEpisode, maxEpisode));
      const fallbackEpisodeCount = Math.max(maxEpisode, 1);

      restoreReadyRef.current = true;
      setAnime(media);
      setActiveEpisode(initialEpisode);

      setEpisodes(buildFallbackEpisodes(fallbackEpisodeCount));

      fetchPreferredEpisodes({
        anilistId,
        malId: media.idMal,
        fallbackCount: fallbackEpisodeCount,
        media,
      })
        .then((episodeData) => {
          if (!isMounted.current) return;
          setEpisodes(episodeData);
          if (episodeData.length > 0) {
            setActiveEpisode((previous) => Math.min(previous, episodeData.length));
          }
        })
        .catch((episodeError) => {
          console.warn('[Watch] Episode fetch failed, using fallback episode list:', episodeError.message);
          if (!isMounted.current) return;
          setEpisodes(buildFallbackEpisodes(fallbackEpisodeCount));
        });
    };

    anilistRequest(ANIME_QUERY, { id: anilistId }, {
      cacheTtlMs: 5 * 60 * 1000,
      key: `watch-meta:${id}`,
    })
      .then((data) => {
        const media = data?.Media;
        if (!media) throw new Error('Anime not found');
        applyMedia(media);
      })
      .catch(async (error) => {
        try {
          const fallback = await fetchJikanAnimeDetails(anilistId, {
            keyPrefix: `watch-meta:jikan:${id}`,
          });
          applyMedia(fallback);
        } catch {
          console.error(error);
        }
      })
      .finally(async () => {
        await ensureMinimumDelay(startedAt);
        if (isMounted.current) setMetaLoading(false);
      });
  }, [id, getProgress, requestedEpisode]);

  const loadStream = useCallback(async (episodeNumber) => {
    if (!anime) return;
    setStreamLoading(true);
    setStreamError('');
    try {
      const titleCandidates = [...new Set([
        anime?.title?.english,
        anime?.title?.romaji,
        anime?.title?.native,
      ].filter(Boolean).map((title) => title.trim()))];

      if (!titleCandidates.length) {
        const fallbackTitle = mediaTitle(anime);
        if (fallbackTitle) titleCandidates.push(fallbackTitle);
      }

      const nextUrl = await fetchStreamUrl({
        titles: titleCandidates,
        episode: episodeNumber,
        year: anime?.seasonYear,
        format: anime?.format,
        totalEpisodes: anime?.episodes,
        duration: anime?.duration,
      });

      setStreamUrl(nextUrl);
    } catch (error) {
      setStreamError(error.message);
    } finally {
      setStreamLoading(false);
    }
  }, [anime]);

  const handleStartWatching = useCallback(() => {
    setHasStarted(true);
    setStreamUrl('');
  }, []);

  useEffect(() => {
    if (!anime || !hasStarted) return;
    loadStream(activeEpisode);
  }, [anime, hasStarted, activeEpisode, loadStream]);

  useEffect(() => {
    setVideoDurationSec(null);
  }, [activeEpisode, streamUrl]);

  useEffect(() => {
    if (!anime || hasStarted) return;
    if (activeEpisode > 1 || (requestedEpisode === activeEpisode && requestedTime > 0)) {
      setHasStarted(true);
    }
  }, [anime, hasStarted, activeEpisode, requestedEpisode, requestedTime]);

  useEffect(() => {
    episodeRefs.current[activeEpisode]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeEpisode]);

  useEffect(() => {
    setSkipTimes(null);
  }, [anime?.id, activeEpisode]);

  useEffect(() => {
    let cancelled = false;

    if (!anime?.idMal || activeEpisode <= 0) {
      setSkipTimes(null);
      return () => {
        cancelled = true;
      };
    }

    fetchSkipTimes(anime.idMal, activeEpisode)
      .then((nextSkipTimes) => {
        if (!cancelled) {
          setSkipTimes(nextSkipTimes);
        }
      })
      .catch((error) => {
        console.warn('[Watch] Skip timestamp fetch failed:', error.message);
        if (!cancelled) {
          setSkipTimes(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [anime?.idMal, activeEpisode]);

  const handleDurationKnown = useCallback((seconds) => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return;
    setVideoDurationSec((previous) => (previous && Math.abs(previous - seconds) < 1 ? previous : seconds));
  }, []);

  useEffect(() => {
    if (anime && activeEpisode > 0 && restoreReadyRef.current) {
      updateProgress(anime.id, {
        episode: activeEpisode,
        seasonId: anime.id,
        totalEpisodes: anime.episodes || 1,
      });
    }
  }, [anime, activeEpisode, updateProgress]);

  const handleNextEpisode = useCallback(() => {
    if (activeEpisode < episodes.length) setActiveEpisode((previous) => previous + 1);
  }, [activeEpisode, episodes.length]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEpisode > 1) setActiveEpisode((previous) => Math.max(1, previous - 1));
  }, [activeEpisode]);

  const handlePlaybackProgress = useCallback(({ currentTime, duration, ended }) => {
    if (!anime || !activeEpisode) return;

    const existing = getProgress(anime.id) || {};
    const safeCurrent = Math.max(0, Math.floor(Number(currentTime) || 0));
    const safeDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Math.floor(Number(duration))
      : null;

    const episodePositions = { ...(existing.episodePositions || {}) };
    const episodeDurations = { ...(existing.episodeDurations || {}) };

    if (safeDuration) episodeDurations[activeEpisode] = safeDuration;

    const nearEndThreshold = safeDuration ? Math.max(8, Math.floor(safeDuration * 0.02)) : 8;
    const treatAsCompleted = ended || (safeDuration ? safeCurrent >= safeDuration - nearEndThreshold : false);

    if (treatAsCompleted || safeCurrent < 3) delete episodePositions[activeEpisode];
    else episodePositions[activeEpisode] = safeCurrent;

    updateProgress(anime.id, {
      episode: activeEpisode,
      seasonId: anime.id,
      totalEpisodes: anime.episodes || 1,
      episodePositions,
      episodeDurations,
    });
  }, [anime, activeEpisode, getProgress, updateProgress]);

  const watchSequence = useMemo(() => getWatchSequence(anime, anime?.relations), [anime]);

  if (!id) {
    return (
      <main className="site-shell flex min-h-screen items-center justify-center px-4">
        <SurfacePanel className="flex items-center gap-2 px-6 py-5 text-sm text-[var(--color-muted)]">
          <RiAlertLine size={18} className="text-[var(--color-brass)]" />
          Missing anime id.
        </SurfacePanel>
      </main>
    );
  }

  if (metaLoading) {
    return <WatchPageSkeleton />;
  }

  if (!anime) {
    return (
      <main className="site-shell flex min-h-screen items-center justify-center px-4">
        <SurfacePanel className="flex items-center gap-2 px-6 py-5 text-sm text-[var(--color-muted)]">
          <RiAlertLine size={18} className="text-[var(--color-brass)]" />
          Anime not found.
        </SurfacePanel>
      </main>
    );
  }

  const title = mediaTitle(anime);
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const seasonLabel = formatSeason(anime.season, anime.seasonYear);
  const description = stripHtml(anime.description);
  const descriptionShort = description.length > 240 ? `${description.slice(0, 240)}...` : description;

  const currentEpisodeData = episodes.find((episode) => episode.mal_id === activeEpisode);
  const nextEpisodeData = episodes.find((episode) => episode.mal_id === activeEpisode + 1);
  const savedProgress = getProgress(anime.id) || null;
  const resumeEpisode = requestedEpisode > 0 ? requestedEpisode : Number(savedProgress?.episode || 0);
  const resumeTimeForActiveEpisode = requestedEpisode === activeEpisode && requestedTime > 0
    ? requestedTime
    : Number(savedProgress?.episodePositions?.[activeEpisode] || 0);
  const hasResumePoint = activeEpisode > 1 || resumeTimeForActiveEpisode > 0;

  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Player View</span>}
      >
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Now Watching</p>
          <h1 className="truncate font-[family:var(--font-display)] text-xl text-[var(--color-ivory)] sm:text-2xl">{title}</h1>
        </div>
      </TopNav>

      {resumeEpisode > 0 && (resumeEpisode > 1 || resumeTimeForActiveEpisode > 0) ? (
        <section className="mx-auto max-w-screen-xl px-4 pt-5 sm:px-6">
          <SurfacePanel className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2 text-sm text-[var(--color-mist)]">
              <RiHistoryLine size={16} className="text-[var(--color-brass)]" />
              {resumeEpisode > 1 ? `Continue from episode ${resumeEpisode}` : 'Resume episode 1'}
            </div>
            <button onClick={() => setActiveEpisode(resumeEpisode)} className="button-primary">
              Resume
            </button>
          </SurfacePanel>
        </section>
      ) : null}

      <section className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.45fr)_24rem]">
          <div className="space-y-6">
            <SurfacePanel className="overflow-hidden p-3 sm:p-5">
              {anime.bannerImage ? (
                <div className="mb-4 h-24 overflow-hidden rounded-[1.1rem] border border-white/8 sm:h-36 sm:rounded-[1.35rem]">
                  <img src={anime.bannerImage} alt="" className="h-full w-full object-cover" />
                </div>
              ) : null}

              <div className="relative overflow-hidden">
                {streamError ? (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[var(--color-ink)] px-4 text-center text-[var(--color-muted)]">
                    <RiAlertLine size={28} className="text-[var(--color-brass)]" />
                    <p className="max-w-md text-sm">{streamError}</p>
                    <button onClick={() => loadStream(activeEpisode)} className="button-primary">Retry Stream</button>
                  </div>
                ) : streamLoading ? (
                  <div className="flex aspect-video flex-col items-center justify-center bg-[var(--color-ink)] text-[var(--color-muted)]">
                    <RiLoader4Line size={28} className="animate-spin text-[var(--color-brass)]" />
                    <p className="mt-3 text-sm">Loading episode...</p>
                  </div>
                ) : !streamUrl && !hasStarted ? (
                  <div className="relative flex aspect-video flex-col items-center justify-center overflow-hidden bg-[var(--color-ink)] px-4 text-center">
                    {anime.coverImage?.extraLarge ? (
                      <img src={anime.coverImage.extraLarge} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
                    ) : null}
                    <div className="relative z-10">
                      <button onClick={handleStartWatching} className="button-primary">
                        <RiPlayMiniFill size={20} className="translate-x-[1px]" />
                        {hasResumePoint ? `Resume Episode ${activeEpisode}` : 'Start Watching'}
                      </button>
                      <p className="mt-3 text-sm text-[var(--color-muted)]">
                        {hasResumePoint ? 'Your saved progress is ready to resume.' : 'Press play to begin episode 1.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <AnimePlayer
                    url={streamUrl}
                    episodeData={{
                      current: currentEpisodeData,
                      nextEpisode: nextEpisodeData ? { number: nextEpisodeData.mal_id, title: nextEpisodeData.title } : null,
                    }}
                    skipTimes={skipTimes}
                    onDurationKnown={handleDurationKnown}
                    onProgress={handlePlaybackProgress}
                    initialSeekTime={resumeTimeForActiveEpisode}
                    episodeDuration={anime.duration || 24}
                    onNextEpisode={handleNextEpisode}
                    onPrevEpisode={handlePrevEpisode}
                    hasNextEpisode={activeEpisode < episodes.length}
                    hasPrevEpisode={activeEpisode > 1}
                    autoPlayNext={true}
                  />
                )}
              </div>

              {episodes.length > 1 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    disabled={activeEpisode <= 1}
                    onClick={() => setActiveEpisode((previous) => Math.max(1, previous - 1))}
                    className="button-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <RiArrowLeftSLine size={18} />
                    <span className="hidden sm:inline">Previous</span>
                    <span className="sm:hidden">Prev</span>
                  </button>
                  <p className="order-first w-full text-center text-[0.72rem] uppercase tracking-[0.14em] text-[var(--color-muted)] sm:order-none sm:w-auto sm:text-sm sm:tracking-[0.16em]">
                    Episode {activeEpisode} / {episodes.length}
                  </p>
                  <button
                    disabled={activeEpisode >= episodes.length}
                    onClick={() => setActiveEpisode((previous) => Math.min(episodes.length, previous + 1))}
                    className="button-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Next
                    <RiArrowRightSLine size={18} />
                  </button>
                </div>
              ) : null}
            </SurfacePanel>

            <SurfacePanel className="overflow-hidden p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]">
                {anime.coverImage?.extraLarge ? (
                  <img
                    src={anime.coverImage.extraLarge}
                    alt={title}
                    className="mx-auto h-48 w-32 rounded-[1.25rem] border border-white/8 object-cover sm:mx-0 sm:rounded-[1.4rem]"
                  />
                ) : null}

                <div className="text-center sm:text-left">
                  <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Episode Context</p>
                  <h2 className="mt-2 font-[family:var(--font-display)] text-2xl text-[var(--color-ivory)] sm:text-3xl">{title}</h2>
                  {anime.title?.native ? <p className="mt-2 text-sm text-[var(--color-muted)]">{anime.title.native}</p> : null}

                  <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                    {score ? <MetaPill icon={RiStarFill} accent="var(--color-brass)">{score}</MetaPill> : null}
                    {anime.format ? <MetaPill icon={RiClapperboardLine}>{anime.format.replace(/_/g, ' ')}</MetaPill> : null}
                    {anime.episodes ? <MetaPill icon={RiTv2Line}>{anime.episodes} eps</MetaPill> : null}
                    {anime.duration ? <MetaPill icon={RiTimeLine}>{anime.duration}m</MetaPill> : null}
                    {seasonLabel ? <MetaPill icon={RiCalendarLine}>{seasonLabel}</MetaPill> : null}
                    {studio ? <MetaPill icon={RiSparkling2Fill}>{studio}</MetaPill> : null}
                    <StatusBadge status={anime.status} />
                  </div>

                  {anime.nextAiringEpisode ? (
                    <p className="mt-4 text-sm text-[var(--color-brass)]">
                      Episode {anime.nextAiringEpisode.episode} airs on {new Date(anime.nextAiringEpisode.airingAt * 1000).toLocaleDateString()}
                    </p>
                  ) : null}

                  {anime.genres?.length ? (
                    <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                      {anime.genres.map((genre) => (
                        <TagChip key={genre}>{genre}</TagChip>
                      ))}
                    </div>
                  ) : null}

                  {description ? (
                    <div className="mt-5">
                      <p className="text-sm leading-7 text-[var(--color-mist)]">
                        {showFullDescription ? description : descriptionShort}
                      </p>
                      {description.length > 240 ? (
                        <button onClick={() => setShowFullDescription((previous) => !previous)} className="mt-2 text-sm text-[var(--color-brass)]">
                          {showFullDescription ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </SurfacePanel>
          </div>

          <div className="space-y-6">
            <SurfacePanel className="overflow-hidden p-5">
              <SectionHeading
                eyebrow="Episode Rail"
                title="Episodes"
                subtitle={`Episode ${activeEpisode} selected${episodes.length > 0 ? ` - ${episodes.length} total` : ''}`}
              />
              <div className="mt-5 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                {episodes.length === 0 ? (
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/5 px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                    No episode data available.
                  </div>
                ) : episodes.map((episode) => (
                  <div key={episode.mal_id} ref={(element) => { episodeRefs.current[episode.mal_id] = element; }}>
                    <EpisodeButton
                      episode={episode}
                      active={episode.mal_id === activeEpisode}
                      loading={streamLoading}
                      onClick={() => {
                        if (episode.mal_id !== activeEpisode) setActiveEpisode(episode.mal_id);
                      }}
                    />
                  </div>
                ))}
              </div>
            </SurfacePanel>

            {watchSequence.length > 1 ? (
              <SurfacePanel className="overflow-hidden p-5">
                <SectionHeading
                  eyebrow="Watch Order"
                  title="Seasons"
                  subtitle="Main seasons, OVAs, side stories, and related titles."
                />
                <div className="mt-5 space-y-3">
                  {watchSequence.map((item) => (
                    <SeasonCard key={item.id} season={item} isCurrent={item.id === anime.id} />
                  ))}
                </div>
              </SurfacePanel>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
