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
    if (!r.ok) {
      if (r.status === 429) throw new Error('Rate limited. Please wait a moment and try again.');
      throw new Error(`HTTP ${r.status}`);
    }
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    return j.data;
  } catch (err) {
    console.error('AniList fetch error:', err.message);
    throw new Error('Failed to fetch anime details. Please try again.');
  }
}

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

function mediaTitle(m) {
  return m?.title?.english || m?.title?.romaji || 'Unknown';
}

function formatStatus(s) {
  return { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'On Hiatus' }[s] ?? s;
}

function formatSeason(s, y) {
  if (!s && !y) return null;
  const season = s ? s[0] + s.slice(1).toLowerCase() : '';
  return [season, y].filter(Boolean).join(' ');
}

function formatRelationType(relationType) {
  return {
    CURRENT: 'Current Season',
    PREQUEL: 'Prequel',
    SEQUEL: 'Sequel',
    SIDE_STORY: 'Side Story',
    SPIN_OFF: 'Spin-Off',
    ALTERNATIVE: 'Alternative',
    COMPILATION: 'Compilation',
    OTHER: 'Related',
  }[relationType] ?? 'Related';
}

function Badge({ children }) {
  return (
    <span className="px-2.5 py-1 rounded-full bg-white/8 border border-white/10 text-xs font-medium text-gray-200">
      {children}
    </span>
  );
}

function AnimeCard({ anime }) {
  const title = mediaTitle(anime);
  const img = anime.coverImage?.extraLarge ?? anime.coverImage?.large;
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const format = anime.format ? anime.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={animeHref(anime.id)}
      className="group relative flex flex-col rounded-2xl overflow-hidden bg-gray-900 border border-white/5 hover:border-rose-500/40 hover:shadow-xl hover:shadow-rose-950/30 transition-all duration-200"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-gray-800">
        {img
          ? <img src={img} alt={title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-600"><Tv size={30} /></div>
        }
        {score && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 rounded-md text-yellow-400 text-xs font-bold">
            <Star size={10} fill="currentColor" />{score}
          </div>
        )}
        {format && (
          <div className="absolute bottom-2 right-2 bg-rose-600/90 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase text-white">
            {format}
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <h3 className="text-sm font-semibold text-gray-100 leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {title}
        </h3>
        <div className="flex flex-wrap gap-1 mt-auto pt-1">
          {anime.genres?.slice(0, 2).map((genre) => (
            <span key={genre} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[10px]">{genre}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function SequenceCard({ anime, isCurrent = false, index = 0 }) {
  const title = mediaTitle(anime);
  const relationLabel = formatRelationType(anime.relationType);
  const formatLabel = anime.format ? anime.format.replace(/_/g, ' ') : null;

  return (
    <Link
      href={animeHref(anime.id)}
      className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
        isCurrent
          ? 'border-rose-500/35 bg-rose-500/10'
          : 'border-white/8 bg-white/5 hover:bg-white/8 hover:border-white/15'
      }`}
    >
      {anime.coverImage?.large && (
        <img src={anime.coverImage.large} alt={title} className="w-12 h-16 object-cover rounded-lg shrink-0" loading="lazy" />
      )}
      <div className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
        isCurrent ? 'bg-rose-500/25 text-rose-200' : 'bg-white/8 text-gray-300'
      }`}>
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-rose-200' : 'text-gray-100'}`}>{title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
          <span className={`${isCurrent ? 'text-rose-200/80' : 'text-gray-400'}`}>{relationLabel}</span>
          {formatLabel && <span className="text-gray-500">{formatLabel}</span>}
          {anime.seasonYear && <span className="text-gray-500">{anime.seasonYear}</span>}
          {anime.episodes && <span className="text-gray-500">{anime.episodes} eps</span>}
        </div>
      </div>
    </Link>
  );
}

function AnimeDetailsInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { getProgress } = useWatchProgress();

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setAnime(null);

    anilist(ANIME_DETAILS_QUERY, { id: Number.parseInt(id, 10) })
      .then((data) => {
        if (cancelled) return;
        if (!data?.Media) {
          throw new Error('Anime not found');
        }
        setAnime(data.Media);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load anime details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        Missing anime id.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={34} className="animate-spin text-rose-500" />
      </div>
    );
  }

  if (error || !anime) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-gray-300 max-w-lg">
          <p className="text-lg font-semibold text-white">Could not load this anime</p>
          <p className="mt-2 text-sm text-gray-400">{error || 'Unknown error'}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/" className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500 transition-colors">
              Go Home
            </Link>
            <Link href="/search" className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-gray-200 hover:bg-white/10 transition-colors">
              Search Anime
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const title = mediaTitle(anime);
  const description = anime.description?.replace(/<[^>]+>/g, '') ?? '';
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const seasonLabel = formatSeason(anime.season, anime.seasonYear);
  const saved = getProgress(anime.id);
  const watchLabel = saved?.episode > 1 ? `Continue from Episode ${saved.episode}` : 'Play Now';

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0">
          {anime.bannerImage ? (
            <img src={anime.bannerImage} alt="" className="w-full h-full object-cover" />
          ) : anime.coverImage?.extraLarge ? (
            <img src={anime.coverImage.extraLarge} alt="" className="w-full h-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/70 to-gray-950" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(244,63,94,0.22),transparent_38%),radial-gradient(circle_at_78%_20%,rgba(34,211,238,0.12),transparent_28%)]" />
        </div>

        <div className="relative max-w-screen-xl mx-auto px-4 py-6 sm:py-10">
          <div className="flex items-center gap-3 mb-8">
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-gray-100 hover:bg-black/40 transition-colors">
              <ArrowLeft size={15} /> Home
            </Link>
            <Link href="/search" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-gray-100 hover:bg-black/40 transition-colors">
              <Sparkles size={15} /> Search
            </Link>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
            <div className="w-40 sm:w-52 shrink-0">
              {anime.coverImage?.extraLarge ? (
                <img src={anime.coverImage.extraLarge} alt={title} className="w-full aspect-[2/3] object-cover rounded-2xl shadow-2xl shadow-black/40" />
              ) : null}
            </div>

            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-rose-300/90">
                <Clapperboard size={13} /> Anime Details
              </div>

              <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight text-white">
                {title}
              </h1>

              {anime.title?.native ? (
                <p className="mt-2 text-sm text-gray-400">{anime.title.native}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {score && <Badge><span className="inline-flex items-center gap-1 text-yellow-300"><Star size={12} fill="currentColor" /> {score}</span></Badge>}
                {anime.format && <Badge>{anime.format.replace(/_/g, ' ')}</Badge>}
                {anime.status && <Badge>{formatStatus(anime.status)}</Badge>}
                {anime.episodes && <Badge><span className="inline-flex items-center gap-1"><Tv size={11} /> {anime.episodes} eps</span></Badge>}
                {anime.duration && <Badge><span className="inline-flex items-center gap-1"><Clock size={11} /> {anime.duration}m</span></Badge>}
                {seasonLabel && <Badge><span className="inline-flex items-center gap-1"><Calendar size={11} /> {seasonLabel}</span></Badge>}
                {studio && <Badge>{studio}</Badge>}
              </div>

              {description ? (
                <p className="mt-5 max-w-3xl text-sm sm:text-base leading-relaxed text-gray-300">
                  {description}
                </p>
              ) : null}

              {anime.genres?.length ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {anime.genres.map((genre) => (
                    <span key={genre} className="px-2.5 py-1 rounded-full bg-rose-900/35 text-rose-200 text-xs border border-rose-500/15">
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={watchHref(anime.id)}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-500 transition-colors"
                >
                  <Play size={15} fill="currentColor" />
                  {watchLabel}
                </Link>
                <Link
                  href={`/search?q=${encodeURIComponent(title)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-gray-100 hover:bg-white/10 transition-colors"
                >
                  Explore Similar
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-screen-xl mx-auto px-4 py-8 space-y-8">
        {watchSequence.length > 1 ? (
          <div className="rounded-2xl border border-white/8 bg-white/5 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-1">
              <Clapperboard size={16} className="text-rose-400" />
              <h2 className="text-lg font-bold text-gray-100">Seasons</h2>
            </div>
            <p className="mb-4 text-sm text-gray-400">
              Main seasons, OVAs, movies, and side stories in watch order.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {watchSequence.map((item, index) => (
                <SequenceCard key={item.id} anime={item} isCurrent={item.id === anime.id} index={index} />
              ))}
            </div>
          </div>
        ) : null}

        {recommendations.length ? (
          <div className="rounded-2xl border border-white/8 bg-white/5 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-cyan-400" />
              <h2 className="text-lg font-bold text-gray-100">Similar Recommendations</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {recommendations.map((item) => (
                <AnimeCard key={item.id} anime={item} />
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
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={34} className="animate-spin text-rose-500" />
      </div>
    }>
      <AnimeDetailsInner />
    </Suspense>
  );
}
