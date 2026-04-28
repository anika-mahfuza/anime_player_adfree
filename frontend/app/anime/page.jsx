'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Clapperboard, Clock, Loader2, Play, Sparkles, Star, Tv } from 'lucide-react';
import { getWatchSequence, useWatchProgress } from '@/hooks/useWatchProgress';
import { apiUrl } from '@/lib/apiBase';
import { animeHref, watchHref } from '@/lib/routes';

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

const ANIME_DETAILS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id title { romaji english native }
      description(asHtml: false)
      coverImage { large extraLarge }
      bannerImage
      episodes meanScore status season seasonYear format duration
      studios(isMain: true) { nodes { name } }
      genres
      relations {
        edges {
          relationType(version: 2)
          node {
            id type format title { romaji english }
            coverImage { large }
            seasonYear status episodes
          }
        }
      }
      recommendations(sort: RATING_DESC, perPage: 12) {
        nodes {
          mediaRecommendation {
            id title { romaji english }
            coverImage { large }
            format meanScore
          }
        }
      }
    }
  }
`;

function mediaTitle(m) { return m?.title?.english || m?.title?.romaji || 'Unknown'; }

export default function AnimeDetailsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>}>
      <AnimeDetailsInner />
    </Suspense>
  );
}

function AnimeDetailsInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const { getProgress } = useWatchProgress();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    anilist(ANIME_DETAILS_QUERY, { id: Number(id) })
      .then(d => setAnime(d.Media))
      .finally(() => setLoading(false));
  }, [id]);

  const watchSequence = useMemo(() => getWatchSequence(anime, anime?.relations), [anime]);
  const recommendations = useMemo(() =>
    (anime?.recommendations?.nodes || []).map(n => n?.mediaRecommendation).filter(Boolean),
  [anime]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-500" /></div>;
  if (!anime) return <div className="p-8 text-center text-gray-500">Anime not found</div>;

  const title = mediaTitle(anime);
  const saved = getProgress(anime.id);
  const watchLabel = saved?.episode > 1 ? `Continue Ep ${saved.episode}` : 'Play Now';

  return (
    <main className="max-w-screen-lg mx-auto px-4 pb-12">
      <nav className="py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-500 hover:text-white flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Back
        </Link>
      </nav>

      <section className="mt-4 flex flex-col md:flex-row gap-8">
        <div className="w-48 shrink-0 mx-auto md:mx-0">
          <img src={anime.coverImage?.extraLarge || anime.coverImage?.large} className="w-full aspect-[2/3] object-cover rounded-xl shadow-lg" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl sm:text-4xl font-bold">{title}</h1>
          <p className="text-gray-500 text-sm mt-1">{anime.title?.native}</p>

          <div className="flex flex-wrap gap-3 mt-4 text-xs font-medium text-gray-400">
            {anime.meanScore && <span className="text-yellow-400">★ {anime.meanScore/10}</span>}
            <span>{anime.format}</span>
            <span>{anime.status}</span>
            <span>{anime.episodes} eps</span>
            <span>{anime.duration}m</span>
          </div>

          <p className="mt-6 text-sm text-gray-300 leading-relaxed line-clamp-6">
            {anime.description?.replace(/<[^>]+>/g, '')}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={watchHref(anime.id)} className="px-8 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-full transition-colors flex items-center gap-2">
              <Play size={18} fill="white" /> {watchLabel}
            </Link>
            <Link href={`/search?q=${encodeURIComponent(title)}`} className="px-8 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-full transition-colors">
              Similar
            </Link>
          </div>
        </div>
      </section>

      {watchSequence.length > 1 && (
        <section className="mt-12">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Seasons</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {watchSequence.map((item, i) => (
              <Link key={item.id} href={animeHref(item.id)} className={`p-3 rounded-lg flex items-center gap-3 border transition-colors ${item.id === anime.id ? 'bg-rose-600/10 border-rose-600/30' : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
                <div className="w-10 h-14 bg-gray-800 rounded overflow-hidden shrink-0">
                  <img src={item.coverImage?.large} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{mediaTitle(item)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{item.seasonYear} · {item.format}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Recommendations</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {recommendations.map(r => (
              <Link key={r.id} href={animeHref(r.id)} className="group">
                <div className="aspect-[2/3] rounded-lg overflow-hidden bg-white/5">
                  <img src={r.coverImage?.large} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                </div>
                <h3 className="mt-2 text-[10px] font-medium text-gray-400 line-clamp-1 group-hover:text-white">{mediaTitle(r)}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
