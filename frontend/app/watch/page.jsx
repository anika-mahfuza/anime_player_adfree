'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AnimePlayer from '@/components/AnimePlayer';
import { useWatchProgress, getWatchSequence } from '@/hooks/useWatchProgress';
import { apiUrl } from '@/lib/apiBase';
import { watchHref } from '@/lib/routes';
import {
  Play, ChevronLeft, Star, Tv, Calendar, Loader2,
  AlertCircle, List, ChevronRight, Clock, RotateCcw, X,
  Clapperboard, Film, Layers
} from 'lucide-react';

// ── APIs ──────────────────────────────────────────────────────────────────────

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

// Fetch skip times from our server-side API (avoids CORS issues)
async function fetchSkipTimes({ malId, episode, episodeLengthSeconds, candidateMalIds = [] }) {
  try {
    const params = new URLSearchParams();
    params.set('malId', String(malId));
    params.set('episode', String(episode));
    if (episodeLengthSeconds) params.set('episodeLength', String(Math.round(episodeLengthSeconds)));
    if (candidateMalIds.length) params.set('candidateMalIds', candidateMalIds.join(','));

    const useMock = new URLSearchParams(window.location.search).get('mock') === 'true';
    if (useMock) params.set('mock', 'true');

    const res = await fetch(apiUrl(`/api/skip-times?${params.toString()}`));
    if (!res.ok) return null;
    const data = await res.json();
    console.log(
      `[SkipTimes] Fetched for ep ${episode}: ${data.skipTimes ? 'Found' : 'Not found'} ` +
      `(source: ${data.source || 'unknown'}, malId: ${data.resolvedMalId || malId})`,
      data
    );
    return data;
  } catch (err) {
    console.log('Skip times not available for this anime:', err.message);
    return null;
  }
}

// Jikan — only for episode titles/data (AniList lacks per-ep data)
async function fetchEpisodes(malId) {
  const first = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=1`).then(r => r.json());
  if (!first.data) return [];
  const last = first.pagination?.last_visible_page ?? 1;
  if (last === 1) return first.data;
  const rest = await Promise.all(
    Array.from({ length: last - 1 }, (_, i) =>
      fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${i + 2}`).then(r => r.json()).then(j => j.data ?? [])
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

  const res = await fetch(apiUrl(`/api/stream?${query.toString()}`));
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? 'Stream fetch failed');
  return json.streamUrl;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mediaTitle(m) { return m?.title?.english || m?.title?.romaji || ''; }

function formatStatus(s) {
  return { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'On Hiatus' }[s] ?? s;
}

function formatSeason(s, y) {
  if (!s && !y) return null;
  const season = s ? s[0] + s.slice(1).toLowerCase() : '';
  return [season, y].filter(Boolean).join(' ');
}

// Build ordered seasons list from relations
function buildSeasons(anime) {
  const KEEP_TYPES = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE'];
  const current = {
    id: anime.id, alId: anime.id, title: anime.title,
    coverImage: anime.coverImage, seasonYear: anime.seasonYear,
    episodes: anime.episodes, status: anime.status, isCurrent: true,
  };

  const related = anime.relations?.edges
    ?.filter(e =>
      KEEP_TYPES.includes(e.relationType) &&
      e.node.type === 'ANIME' &&
      e.node.id &&
      ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL', 'MOVIE'].includes(e.node.format)
    )
    .map(e => ({
      id: e.node.id, alId: e.node.id, title: e.node.title,
      coverImage: e.node.coverImage, seasonYear: e.node.seasonYear,
      episodes: e.node.episodes, status: e.node.status,
      relationType: e.relationType, isCurrent: false,
    })) ?? [];

  return [current, ...related].sort((a, b) => (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999));
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Badge({ children, className = '' }) {
  return (
    <span className={`px-2 py-0.5 rounded-md bg-white/10 text-xs font-medium text-gray-300 ${className}`}>
      {children}
    </span>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-rose-500" />
      </div>
    }>
      <WatchPageContent />
    </Suspense>
  );
}

function EpisodeButton({ ep, active, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-150 text-left group
                  ${active ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/40' : 'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white'}`}
    >
      {loading && active
        ? <Loader2 size={13} className="animate-spin shrink-0" />
        : <Play size={13} className={`shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} />
      }
      <span className="truncate">
        {ep.title ? `${ep.mal_id}. ${ep.title}` : `Episode ${ep.mal_id}`}
      </span>
      {ep.filler && <span className="ml-auto text-[10px] text-yellow-500/80 shrink-0">Filler</span>}
    </button>
  );
}

function SeasonCard({ season, isCurrent }) {
  const title = mediaTitle(season);
  const img = season.coverImage?.large;
  return (
    <Link
      href={watchHref(season.id)}
      className={`flex items-center gap-2.5 p-2 rounded-lg transition-all group
                  ${isCurrent ? 'bg-rose-600/20 border border-rose-500/30' : 'hover:bg-white/5 border border-transparent'}`}
    >
      {img && <img src={img} alt={title} className="w-9 h-12 object-cover rounded shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold truncate ${isCurrent ? 'text-rose-300' : 'text-gray-300 group-hover:text-white'}`}>{title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {season.seasonYear && <span className="text-gray-600 text-[10px]">{season.seasonYear}</span>}
          {season.episodes && <span className="text-gray-600 text-[10px]">{season.episodes} eps</span>}
        </div>
      </div>
      {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 animate-pulse" />}
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
function WatchPageContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  const [anime, setAnime] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [activeEp, setActiveEp] = useState(1);
  const [streamUrl, setStreamUrl] = useState('');
  const [metaLoading, setMetaLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [skipTimes, setSkipTimes] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [videoDurationSec, setVideoDurationSec] = useState(null);

  const epRefs = useRef({});
  const { updateProgress, getProgress } = useWatchProgress();

// ── Load metadata ──────────────────────────────────────────────────────────
  const isMounted = useRef(true);
  
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  
  useEffect(() => {
    if (!id) return;
    setMetaLoading(true);
    setAnime(null);
    setEpisodes([]);
    setActiveEp(1);
    setStreamUrl('');

    const alId = parseInt(id, 10);

    anilist(ANIME_QUERY, { id: alId }).then(alData => {
      if (!isMounted.current) return;
      const media = alData?.Media;
      if (!media) throw new Error('Anime not found');
      setAnime(media);
      setSeasons(buildSeasons(media));

      // Check for saved progress
      const saved = getProgress(media.id);
      if (saved && saved.episode > 0) {
        setActiveEp(saved.episode);
      }

      const malId = media.idMal;
      if (malId) {
        fetchEpisodes(malId).then(epData => {
          if (epData.length) {
            setEpisodes(epData);
          } else if (media.episodes) {
            setEpisodes(Array.from({ length: media.episodes }, (_, i) => ({ mal_id: i + 1, title: null })));
          }
        });
} else if (media.episodes) {
            setEpisodes(Array.from({ length: media.episodes }, (_, i) => ({ mal_id: i + 1, title: null })));
          }
    }).catch(err => {
      console.error(err);
    }).finally(() => setMetaLoading(false));
}, [id]);

  // ── Load stream function ─────────────────────────────────────────────────────────
  const loadStream = useCallback(async (ep) => {
    if (!anime) return;
    if (streamUrl && streamUrl.includes(`/api/stream`) && !streamLoading) {
      return;
    }
    setStreamLoading(true);
    setStreamError('');
    try {
      const titleCandidates = [...new Set([
        anime?.title?.english,
        anime?.title?.romaji,
        anime?.title?.native,
      ].filter(Boolean).map(t => t.trim()))];

      if (!titleCandidates.length) {
        const fallbackTitle = mediaTitle(anime);
        if (fallbackTitle) titleCandidates.push(fallbackTitle);
      }

      const url = await fetchStreamUrl({
        titles: titleCandidates,
        episode: ep,
        year: anime?.seasonYear,
        format: anime?.format,
        totalEpisodes: anime?.episodes,
        duration: anime?.duration,
      });
      setStreamUrl(url);
    } catch (err) {
      setStreamError(err.message);
    } finally {
      setStreamLoading(false);
    }
  }, [anime, streamUrl, streamLoading]);

  // ── Load stream only when episode changes or user starts ────────────────────────────
  const handleStartWatching = useCallback(() => {
    setHasStarted(true);
    setStreamUrl('');
    setStreamLoading(true); // Show loading immediately
    loadStream(activeEp);
  }, [activeEp, loadStream]);

  useEffect(() => {
    if (!anime || !hasStarted) return;
    loadStream(activeEp);
  }, [activeEp]);

  useEffect(() => {
    setVideoDurationSec(null);
  }, [activeEp, streamUrl]);

  // Auto-start from 2nd episode if resuming
  useEffect(() => {
    if (!anime || hasStarted) return;
    if (activeEp > 1) {
      setHasStarted(true);
    }
  }, [activeEp]);

  // Scroll active ep into view
  useEffect(() => {
    epRefs.current[activeEp]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeEp]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sidebarOpen]);

  // Fetch skip times when episode or anime changes
  useEffect(() => {
    if (!anime?.idMal || !activeEp) {
      setSkipTimes(null);
      return;
    }

    const candidateMalIds = [
      anime.idMal,
      ...(anime.relations?.edges?.map(edge => edge?.node?.idMal) ?? []),
    ].filter(Boolean);

    const fallbackDurationSec = Math.round((anime.duration || 24) * 60);
    const requestedLength = videoDurationSec || fallbackDurationSec;

    let cancelled = false;
    setSkipTimes(null);

    fetchSkipTimes({
      malId: anime.idMal,
      episode: activeEp,
      episodeLengthSeconds: requestedLength,
      candidateMalIds,
    }).then(payload => {
      if (cancelled) return;
      const times = payload?.skipTimes || null;
      setSkipTimes(times);
      console.log(`[Watch] Skip times loaded for ep ${activeEp}:`, times);
    });

    return () => {
      cancelled = true;
    };
  }, [anime, activeEp, videoDurationSec]);

  const handleDurationKnown = useCallback((seconds) => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return;
    setVideoDurationSec(prev => (prev && Math.abs(prev - seconds) < 1 ? prev : seconds));
  }, []);

  // Save progress when episode changes
  useEffect(() => {
    if (anime && activeEp > 0) {
      updateProgress(anime.id, {
        episode: activeEp,
        seasonId: anime.id,
        totalEpisodes: anime.episodes || 1
      });
    }
  }, [anime, activeEp, updateProgress]);

  // ── Episode navigation callbacks for player ───────────────────────────────
  const handleNextEpisode = useCallback(() => {
    if (activeEp < episodes.length) {
      setActiveEp(p => p + 1);
    }
  }, [activeEp, episodes.length]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEp > 1) {
      setActiveEp(p => Math.max(1, p - 1));
    }
  }, [activeEp]);

  const handlePlaybackProgress = useCallback(({ currentTime, duration, ended }) => {
    if (!anime || !activeEp) return;

    const existing = getProgress(anime.id) || {};
    const safeCurrent = Math.max(0, Math.floor(Number(currentTime) || 0));
    const safeDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Math.floor(Number(duration))
      : null;

    const episodePositions = { ...(existing.episodePositions || {}) };
    const episodeDurations = { ...(existing.episodeDurations || {}) };

    if (safeDuration) {
      episodeDurations[activeEp] = safeDuration;
    }

    const nearEndThreshold = safeDuration ? Math.max(8, Math.floor(safeDuration * 0.02)) : 8;
    const treatAsCompleted = ended || (safeDuration ? safeCurrent >= safeDuration - nearEndThreshold : false);

    if (treatAsCompleted || safeCurrent < 3) {
      delete episodePositions[activeEp];
    } else {
      episodePositions[activeEp] = safeCurrent;
    }

    updateProgress(anime.id, {
      episode: activeEp,
      seasonId: anime.id,
      totalEpisodes: anime.episodes || 1,
      episodePositions,
      episodeDurations,
    });
  }, [anime, activeEp, getProgress, updateProgress]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  if (!id) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
      <AlertCircle className="mr-2" /> Missing anime id.
    </div>
  );

  if (metaLoading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 size={36} className="animate-spin text-rose-500" />
        <span className="text-sm">Loading anime…</span>
      </div>
    </div>
  );

  if (!anime) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
      <AlertCircle className="mr-2" /> Anime not found.
    </div>
  );

  const title = mediaTitle(anime);
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const season = formatSeason(anime.season, anime.seasonYear);
  const desc = anime.description?.replace(/<[^>]+>/g, '') ?? '';
  const descShort = desc.length > 200 ? desc.slice(0, 200) + '…' : desc;

  const currentEpisodeData = episodes.find(ep => ep.mal_id === activeEp);
  const nextEpisodeData = episodes.find(ep => ep.mal_id === activeEp + 1);
  const savedProgress = anime ? getProgress(anime.id) : null;
  const resumeTimeForActiveEpisode = Number(savedProgress?.episodePositions?.[activeEp] || 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ── Banner ── */}
      {anime.bannerImage && (
        <div className="relative h-36 sm:h-48 w-full overflow-hidden">
          <img src={anime.bannerImage} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-gray-950" />
        </div>
      )}

      {/* ── Continue Watching Banner ── */}
      {(() => {
        const saved = getProgress(anime.id);
        if (saved && saved.episode > 1) {
          return (
            <div className="bg-rose-900/30 border-b border-rose-500/30 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-200 text-sm">
                <RotateCcw size={14} />
                <span>Continue from Episode {saved.episode}?</span>
              </div>
              <button
                onClick={() => setActiveEp(saved.episode)}
                className="text-xs px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded transition-colors"
              >
                Resume
              </button>
            </div>
          );
        }
        return null;
      })()}

      {/* ── Top nav ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm shrink-0">
          <ChevronLeft size={16} /><span>Back</span>
        </Link>
        <span className="text-white/20">·</span>
        <h1 className="text-sm font-semibold truncate text-gray-100 flex-1">{title}</h1>
        <span className="text-xs text-gray-500 shrink-0">Ep {activeEp}</span>
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          title="Toggle episode list"
        >
          <List size={16} />
        </button>
      </nav>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left — player + info ── */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5 min-w-0">

          {/* Player */}
          <div className="relative">
            {streamError ? (
              <div className="w-full aspect-video bg-gray-900 rounded-xl flex flex-col items-center justify-center gap-3 text-gray-400">
                <AlertCircle size={32} className="text-rose-500" />
                <p className="text-sm text-center max-w-xs">{streamError}</p>
                <button onClick={() => loadStream(activeEp)}
                  className="text-xs px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors">
                  Retry
                </button>
              </div>
            ) : streamLoading ? (
              <div className="w-full aspect-video bg-gray-900 rounded-xl flex flex-col items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-3 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
                  <p className="text-gray-400 text-sm">Loading...</p>
                </div>
              </div>
            ) : !streamUrl && !hasStarted ? (
              <div className="relative w-full aspect-video bg-gray-900 rounded-xl flex flex-col items-center justify-center">
                <button
                  onClick={handleStartWatching}
                  className="flex items-center gap-2 px-6 py-3 bg-rose-600 hover:bg-rose-700 rounded-full transition-all shadow-lg shadow-rose-600/20"
                >
                  <Play size={20} fill="white" className="text-white" />
                  <span className="text-white font-semibold text-sm">Start Watching</span>
                  {activeEp > 1 && (
                    <span className="text-rose-200 text-xs ml-1">- Ep {activeEp}</span>
                  )}
                </button>
                {activeEp === 1 && (
                  <p className="text-gray-500 text-xs mt-3">Click to play episode 1</p>
                )}
              </div>
            ) : (
              <AnimePlayer
                url={streamUrl}
                episodeData={{
                  current: currentEpisodeData,
                  nextEpisode: nextEpisodeData ? { number: nextEpisodeData.mal_id, title: nextEpisodeData.title } : null
                }}
                skipTimes={skipTimes}
                onDurationKnown={handleDurationKnown}
                onProgress={handlePlaybackProgress}
                initialSeekTime={resumeTimeForActiveEpisode}
                episodeDuration={anime.duration || 24}
                onNextEpisode={handleNextEpisode}
                onPrevEpisode={handlePrevEpisode}
                hasNextEpisode={activeEp < episodes.length}
                hasPrevEpisode={activeEp > 1}
                autoPlayNext={true}
              />
            )}
          </div>

          {/* Ep prev / next nav */}
          {episodes.length > 1 && (
            <div className="flex items-center gap-3">
              <button
                disabled={activeEp <= 1}
                onClick={() => setActiveEp(p => Math.max(1, p - 1))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10
                           text-gray-400 hover:text-white text-xs font-medium transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs text-gray-500 flex-1 text-center">Episode {activeEp} / {episodes.length}</span>
              <button
                disabled={activeEp >= episodes.length}
                onClick={() => setActiveEp(p => Math.min(episodes.length, p + 1))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10
                           text-gray-400 hover:text-white text-xs font-medium transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Anime info */}
          <div className="flex gap-4 bg-white/5 rounded-xl p-4 border border-white/5">
            {anime.coverImage?.extraLarge && (
              <img src={anime.coverImage.extraLarge} alt={title}
                className="w-24 h-36 object-cover rounded-lg shrink-0 shadow-xl" />
            )}
            <div className="flex flex-col gap-2.5 min-w-0 flex-1">
              <div>
                <h2 className="text-lg font-bold text-white leading-tight">{title}</h2>
                {anime.title?.native && (
                  <p className="text-xs text-gray-500 mt-0.5">{anime.title.native}</p>
                )}
              </div>

              {/* Badges row */}
              <div className="flex flex-wrap gap-2 items-center">
                {score && (
                  <span className="flex items-center gap-1 text-yellow-400 text-sm font-bold">
                    <Star size={13} fill="currentColor" />{score}
                  </span>
                )}
                {anime.format && <Badge>{anime.format}</Badge>}
                {anime.status && <Badge>{formatStatus(anime.status)}</Badge>}
                {anime.episodes && <Badge><Tv size={10} className="inline mr-1" />{anime.episodes} eps</Badge>}
                {anime.duration && <Badge><Clock size={10} className="inline mr-1" />{anime.duration}m</Badge>}
                {season && <Badge><Calendar size={10} className="inline mr-1" />{season}</Badge>}
                {studio && <Badge>{studio}</Badge>}
              </div>

              {/* Next airing */}
              {anime.nextAiringEpisode && (
                <p className="text-xs text-rose-400">
                  EP {anime.nextAiringEpisode.episode} airs{' '}
                  {new Date(anime.nextAiringEpisode.airingAt * 1000).toLocaleDateString()}
                </p>
              )}

              {/* Genres */}
              {anime.genres?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {anime.genres.map(g => (
                    <span key={g} className="px-2 py-0.5 rounded-full bg-rose-900/40 text-rose-300 text-xs">{g}</span>
                  ))}
                </div>
              )}

              {/* Synopsis */}
              {desc && (
                <div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {showFullDesc ? desc : descShort}
                  </p>
                  {desc.length > 200 && (
                    <button onClick={() => setShowFullDesc(v => !v)}
                      className="text-xs text-rose-400 hover:text-rose-300 mt-1 transition-colors">
                      {showFullDesc ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Related seasons */}
          {seasons.length > 1 && (
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Watch Order</h3>
              <div className="flex flex-col gap-2">
                {seasons.map((s, idx) => (
                  <Link
                    key={s.id}
                    href={watchHref(s.id)}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-all group
                                ${s.isCurrent ? 'bg-rose-600/20 border border-rose-500/30' : 'hover:bg-white/5 border border-transparent'}`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                                     ${s.isCurrent ? 'bg-rose-600 text-white' : 'bg-white/10 text-gray-400 group-hover:bg-white/20'}`}>
                      {idx + 1}
                    </span>
                    {s.coverImage?.large && (
                      <img src={s.coverImage.large} alt="" className="w-8 h-10 object-cover rounded" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold truncate ${s.isCurrent ? 'text-rose-300' : 'text-gray-300 group-hover:text-white'}`}>
                        {mediaTitle(s)}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {s.seasonYear && <span className="text-gray-600 text-[10px]">{s.seasonYear}</span>}
                        {s.episodes && <span className="text-gray-600 text-[10px]">{s.episodes} eps</span>}
                      </div>
                    </div>
                    {s.isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 animate-pulse" />}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Episode overlay drawer ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-[70]">
          <button
            aria-label="Close episodes drawer"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/65 backdrop-blur-[1px]"
          />

          <aside className="absolute right-0 top-0 h-full w-full max-w-sm border-l border-white/10 bg-gray-950 flex flex-col overflow-hidden shadow-2xl shadow-black/50">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-100">Episodes</span>
                <span className="text-xs text-gray-500">{episodes.length} total</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                title="Close episode list"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {episodes.length === 0 ? (
                <div className="text-center text-gray-600 text-xs py-8">No episode data</div>
              ) : episodes.map(ep => (
                <div key={ep.mal_id} ref={el => { epRefs.current[ep.mal_id] = el; }}>
                  <EpisodeButton
                    ep={ep}
                    active={ep.mal_id === activeEp}
                    loading={streamLoading}
                    onClick={() => { if (ep.mal_id !== activeEp) setActiveEp(ep.mal_id); }}
                  />
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
