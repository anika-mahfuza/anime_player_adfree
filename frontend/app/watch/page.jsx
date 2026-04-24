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
import { apiUrl } from '@/lib/apiBase';
import { formatRelationType, formatSeason, mediaTitle, stripHtml } from '@/lib/media';
import { animeHref } from '@/lib/routes';

async function anilist(query, variables = {}) {
  try {
    const response = await fetch(apiUrl('/api/anilist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited. Please wait a moment and try again.');
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.errors) throw new Error(payload.errors[0].message);
    return payload.data;
  } catch (error) {
    console.error('AniList fetch error:', error.message);
    throw new Error('Failed to fetch anime data. Please try again.');
  }
}

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

async function fetchSkipTimes({
  malId,
  anilistId,
  episode,
  episodeLengthSeconds,
  candidateMalIds = [],
  candidateAnilistIds = [],
}) {
  try {
    const params = new URLSearchParams();
    params.set('malId', String(malId));
    if (anilistId) params.set('anilistId', String(anilistId));
    params.set('episode', String(episode));
    if (episodeLengthSeconds) params.set('episodeLength', String(Math.round(episodeLengthSeconds)));
    if (candidateMalIds.length) params.set('candidateMalIds', candidateMalIds.join(','));
    if (candidateAnilistIds.length) params.set('candidateAnilistIds', candidateAnilistIds.join(','));

    const useMock = new URLSearchParams(window.location.search).get('mock') === 'true';
    if (useMock) params.set('mock', 'true');

    const response = await fetch(apiUrl(`/api/skip-times?${params.toString()}`));
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.log('Skip times not available for this anime:', error.message);
    return null;
  }
}

async function fetchEpisodes(malId) {
  const first = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=1`).then((response) => response.json());
  if (!first.data) return [];
  const last = first.pagination?.last_visible_page ?? 1;
  if (last === 1) return first.data;
  const rest = await Promise.all(
    Array.from({ length: last - 1 }, (_, index) =>
      fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${index + 2}`)
        .then((response) => response.json())
        .then((payload) => payload.data ?? [])
    )
  );
  return [...first.data, ...rest.flat()];
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

  const response = await fetch(apiUrl(`/api/stream?${query.toString()}`));
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error ?? 'Stream fetch failed');
  return payload.streamUrl;
}

const SKIP_TIME_FALLBACK_RELATIONS = new Set([
  'PREQUEL',
  'SEQUEL',
  'SIDE_STORY',
  'SPIN_OFF',
  'ALTERNATIVE',
  'COMPILATION',
  'OTHER',
]);

function EpisodeButton({ episode, active, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[1.15rem] border px-4 py-3 text-left transition ${
        active
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

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    setMetaLoading(true);
    setAnime(null);
    setEpisodes([]);
    setActiveEpisode(1);
    setStreamUrl('');

    const anilistId = Number.parseInt(id, 10);

    anilist(ANIME_QUERY, { id: anilistId })
      .then((data) => {
        if (!isMounted.current) return;
        const media = data?.Media;
        if (!media) throw new Error('Anime not found');
        setAnime(media);

        const saved = getProgress(media.id);
        if (saved && saved.episode > 0) setActiveEpisode(saved.episode);

        const malId = media.idMal;
        if (malId) {
          fetchEpisodes(malId).then((episodeData) => {
            if (!isMounted.current) return;
            if (episodeData.length) {
              setEpisodes(episodeData);
            } else if (media.episodes) {
              setEpisodes(Array.from({ length: media.episodes }, (_, index) => ({ mal_id: index + 1, title: null })));
            }
          });
        } else if (media.episodes) {
          setEpisodes(Array.from({ length: media.episodes }, (_, index) => ({ mal_id: index + 1, title: null })));
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => setMetaLoading(false));
  }, [id, getProgress]);

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
    setStreamLoading(true);
    loadStream(activeEpisode);
  }, [activeEpisode, loadStream]);

  useEffect(() => {
    if (!anime || !hasStarted) return;
    loadStream(activeEpisode);
  }, [anime, hasStarted, activeEpisode, loadStream]);

  useEffect(() => {
    setVideoDurationSec(null);
  }, [activeEpisode, streamUrl]);

  useEffect(() => {
    if (!anime || hasStarted) return;
    if (activeEpisode > 1) setHasStarted(true);
  }, [anime, hasStarted, activeEpisode]);

  useEffect(() => {
    episodeRefs.current[activeEpisode]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeEpisode]);

  useEffect(() => {
    setSkipTimes(null);
  }, [anime?.id, activeEpisode]);

  useEffect(() => {
    if (!anime?.idMal || !activeEpisode || !hasStarted || !streamUrl || !videoDurationSec) return;

    const candidateMalIds = [
      anime.idMal,
      ...(anime.relations?.edges
        ?.filter((edge) =>
          SKIP_TIME_FALLBACK_RELATIONS.has(edge?.relationType) &&
          edge?.node?.type === 'ANIME' &&
          edge?.node?.idMal
        )
        .map((edge) => edge.node.idMal) ?? []),
    ].filter(Boolean);

    const candidateAnilistIds = [
      anime.id,
      ...(anime.relations?.edges
        ?.filter((edge) =>
          SKIP_TIME_FALLBACK_RELATIONS.has(edge?.relationType) &&
          edge?.node?.type === 'ANIME' &&
          edge?.node?.id
        )
        .map((edge) => edge.node.id) ?? []),
    ].filter(Boolean);

    let cancelled = false;

    fetchSkipTimes({
      malId: anime.idMal,
      anilistId: anime.id,
      episode: activeEpisode,
      episodeLengthSeconds: videoDurationSec,
      candidateMalIds,
      candidateAnilistIds,
    }).then((payload) => {
      if (cancelled) return;
      setSkipTimes(payload?.skipTimes || null);
    });

    return () => {
      cancelled = true;
    };
  }, [anime, activeEpisode, hasStarted, streamUrl, videoDurationSec]);

  const handleDurationKnown = useCallback((seconds) => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return;
    setVideoDurationSec((previous) => (previous && Math.abs(previous - seconds) < 1 ? previous : seconds));
  }, []);

  useEffect(() => {
    if (anime && activeEpisode > 0) {
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
  const resumeTimeForActiveEpisode = Number(savedProgress?.episodePositions?.[activeEpisode] || 0);

  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Player View</span>}
      >
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Now Watching</p>
          <h1 className="truncate font-[family:var(--font-display)] text-2xl text-[var(--color-ivory)]">{title}</h1>
        </div>
      </TopNav>

      {savedProgress?.episode > 1 ? (
        <section className="mx-auto max-w-screen-xl px-4 pt-5 sm:px-6">
          <SurfacePanel className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-mist)]">
              <RiHistoryLine size={16} className="text-[var(--color-brass)]" />
              Continue from episode {savedProgress.episode}
            </div>
            <button onClick={() => setActiveEpisode(savedProgress.episode)} className="button-primary">
              Resume
            </button>
          </SurfacePanel>
        </section>
      ) : null}

      <section className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_24rem]">
          <div className="space-y-6">
            <SurfacePanel className="overflow-hidden p-4 sm:p-5">
              {anime.bannerImage ? (
                <div className="mb-4 h-28 overflow-hidden rounded-[1.35rem] border border-white/8 sm:h-36">
                  <img src={anime.bannerImage} alt="" className="h-full w-full object-cover" />
                </div>
              ) : null}

              <div className="relative overflow-hidden rounded-[1.5rem] bg-black">
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
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.2),rgba(8,10,14,0.9))]" />
                    <div className="relative z-10">
                      <button onClick={handleStartWatching} className="button-primary">
                        <RiPlayMiniFill size={20} className="translate-x-[1px]" />
                        {activeEpisode > 1 ? `Resume Episode ${activeEpisode}` : 'Start Watching'}
                      </button>
                      <p className="mt-3 text-sm text-[var(--color-muted)]">
                        {activeEpisode > 1 ? 'Your saved progress is ready to resume.' : 'Press play to begin episode 1.'}
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
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    disabled={activeEpisode <= 1}
                    onClick={() => setActiveEpisode((previous) => Math.max(1, previous - 1))}
                    className="button-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <RiArrowLeftSLine size={18} />
                    Previous
                  </button>
                  <p className="text-sm uppercase tracking-[0.16em] text-[var(--color-muted)]">
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
              <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)]">
                {anime.coverImage?.extraLarge ? (
                  <img
                    src={anime.coverImage.extraLarge}
                    alt={title}
                    className="h-48 w-32 rounded-[1.4rem] border border-white/8 object-cover"
                  />
                ) : null}

                <div>
                  <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Episode Context</p>
                  <h2 className="mt-2 font-[family:var(--font-display)] text-3xl text-[var(--color-ivory)]">{title}</h2>
                  {anime.title?.native ? <p className="mt-2 text-sm text-[var(--color-muted)]">{anime.title.native}</p> : null}

                  <div className="mt-4 flex flex-wrap gap-2">
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
                    <div className="mt-4 flex flex-wrap gap-2">
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
                subtitle={`Episode ${activeEpisode} selected${episodes.length > 0 ? ` • ${episodes.length} total` : ''}`}
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
