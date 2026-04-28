'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AnimePlayer from '@/components/AnimePlayer';
import { useWatchProgress, getWatchSequence } from '@/hooks/useWatchProgress';
import { apiUrl } from '@/lib/apiBase';
import { animeHref } from '@/lib/routes';
import { Play, ChevronLeft, Star, Loader2, AlertCircle, ChevronRight, List } from 'lucide-react';

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
    throw new Error(err.message || 'Failed to fetch');
  }
}

const ANIME_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id idMal title { romaji english }
      bannerImage coverImage { extraLarge large }
      episodes meanScore format duration
      relations {
        edges {
          relationType(version: 2)
          node { id idMal type format title { romaji english } coverImage { large } }
        }
      }
    }
  }
`;

async function fetchStreamUrl({ titles, episode, year, format, totalEpisodes, duration }) {
  const query = new URLSearchParams({ title: titles[0], episode: String(episode) });
  const res = await fetch(apiUrl(`/api/stream?${query.toString()}`));
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? 'Stream failed');
  return json.streamUrl;
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>}>
      <WatchPageContent />
    </Suspense>
  );
}

function WatchPageContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [anime, setAnime] = useState(null);
  const [activeEp, setActiveEp] = useState(1);
  const [streamUrl, setStreamUrl] = useState('');
  const [skipTimes, setSkipTimes] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const { updateProgress, getProgress } = useWatchProgress();

  useEffect(() => {
    if (!id) return;
    setMetaLoading(true);
    anilist(ANIME_QUERY, { id: Number(id) }).then(d => {
      const media = d?.Media;
      setAnime(media);
      const saved = getProgress(media.id);
      if (saved?.episode) setActiveEp(saved.episode);
    }).finally(() => setMetaLoading(false));
  }, [id]);

  const loadStream = useCallback(async (ep) => {
    if (!anime) return;
    setStreamLoading(true);
    setSkipTimes(null);
    try {
      const url = await fetchStreamUrl({
        titles: [anime.title?.english || anime.title?.romaji],
        episode: ep,
      });
      setStreamUrl(url);

      if (anime.idMal) {
        const skipRes = await fetch(apiUrl(`/api/skip-times?malId=${anime.idMal}&episode=${ep}`));
        if (skipRes.ok) {
          const skipData = await skipRes.json();
          setSkipTimes(skipData.skipTimes);
        }
      }
    } catch (err) { console.error(err); }
    finally { setStreamLoading(false); }
  }, [anime]);

  const handleStart = () => { setHasStarted(true); loadStream(activeEp); };

  useEffect(() => {
    if (hasStarted) loadStream(activeEp);
  }, [activeEp]);

  useEffect(() => {
    if (anime && activeEp) updateProgress(anime.id, { episode: activeEp, seasonId: anime.id, totalEpisodes: anime.episodes || 1 });
  }, [anime, activeEp]);

  if (metaLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>;
  if (!anime) return <div className="p-8 text-center text-gray-500">Not found</div>;

  const episodes = Array.from({ length: anime.episodes || 1 }, (_, i) => i + 1);

  return (
    <div className="max-w-screen-xl mx-auto px-4 pb-12">
      <nav className="py-4 flex items-center gap-4">
        <Link href={animeHref(anime.id)} className="text-gray-500 hover:text-white flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Details
        </Link>
        <h1 className="text-sm font-bold truncate flex-1">{anime.title?.english || anime.title?.romaji}</h1>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="aspect-video bg-white/5 rounded-xl overflow-hidden relative border border-white/5">
            {!hasStarted ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <button onClick={handleStart} className="w-16 h-16 bg-rose-600 rounded-full flex items-center justify-center hover:scale-105 transition-transform">
                  <Play size={24} fill="white" className="ml-1" />
                </button>
                <p className="text-sm font-bold text-gray-400">Play Episode {activeEp}</p>
              </div>
            ) : streamLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="animate-spin text-rose-500" />
              </div>
            ) : (
              <AnimePlayer
                url={streamUrl}
                skipTimes={skipTimes}
                onNextEpisode={() => activeEp < episodes.length && setActiveEp(e => e + 1)}
                onPrevEpisode={() => activeEp > 1 && setActiveEp(e => e - 1)}
                hasNextEpisode={activeEp < episodes.length}
                hasPrevEpisode={activeEp > 1}
                initialSeekTime={getProgress(anime.id)?.episode === activeEp ? getProgress(anime.id)?.currentTime || 0 : 0}
                onProgress={({ currentTime }) => {
                  updateProgress(anime.id, {
                    currentTime,
                    episode: activeEp,
                    seasonId: anime.id,
                    totalEpisodes: anime.episodes || 1
                  });
                }}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <button disabled={activeEp <= 1} onClick={() => setActiveEp(e => e - 1)} className="px-4 py-2 bg-white/5 rounded-lg text-xs hover:bg-white/10 disabled:opacity-30">Prev</button>
            <span className="text-xs font-bold text-gray-500">Episode {activeEp} / {episodes.length}</span>
            <button disabled={activeEp >= episodes.length} onClick={() => setActiveEp(e => e + 1)} className="px-4 py-2 bg-white/5 rounded-lg text-xs hover:bg-white/10 disabled:opacity-30">Next</button>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/5 flex gap-4">
            <img src={anime.coverImage?.large} className="w-16 h-24 object-cover rounded-lg shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold line-clamp-1">{anime.title?.english || anime.title?.romaji}</h2>
              <div className="flex gap-3 mt-2 text-[10px] text-gray-500 font-bold uppercase">
                {anime.meanScore && <span className="text-yellow-400">★ {anime.meanScore/10}</span>}
                <span>{anime.format}</span>
                <span>{anime.duration}m</span>
              </div>
              <p className="mt-2 text-xs text-gray-400 line-clamp-2">Currently watching episode {activeEp} of {anime.episodes}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white/5 rounded-xl border border-white/5 overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <List size={14} className="text-rose-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Episodes</h3>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-2 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 gap-2">
              {episodes.map(num => (
                <button
                  key={num}
                  onClick={() => setActiveEp(num)}
                  className={`py-2 rounded-lg text-xs font-bold transition-colors ${num === activeEp ? 'bg-rose-600 text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {getWatchSequence(anime, anime?.relations).length > 1 && (
            <div className="bg-white/5 rounded-xl border border-white/5 p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-4">Other Seasons</h3>
              <div className="space-y-3">
                {getWatchSequence(anime, anime?.relations).slice(0, 5).map(s => (
                  <Link key={s.id} href={animeHref(s.id)} className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${s.id === anime.id ? 'bg-rose-600/10' : 'hover:bg-white/5'}`}>
                    <img src={s.coverImage?.large} className="w-8 h-10 object-cover rounded" />
                    <p className="text-[10px] font-bold truncate flex-1">{s.title?.english || s.title?.romaji}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
