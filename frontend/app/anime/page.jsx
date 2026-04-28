'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
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
      className={`surface-panel flex items-center gap-4 p-4 ${isCurrent ? '!border-2 !border-[var(--color-brass)] shadow-[0_0_0_1px_rgba(196,160,96,0.2)]' : ''}`}
    >
      {anime.coverImage?.large ? (
        <img src={anime.coverImage.large} alt={title} className="h-20 w-14 rounded-lg object-cover" loading="lazy" />
      ) : (
        <div className="flex h-20 w-14 items-center justify-center rounded-lg bg-[var(--color-ink)] text-[var(--color-muted)]">
          <RiTv2Line size={22} />
        </div>
      )}
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${isCurrent ? 'border-[var(--color-brass)] bg-[rgba(196,160,96,0.14)] text-[var(--color-ivory)]' : 'border-white/10 bg-white/5 text-[var(--color-mist)]'}`}>
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isCurrent ? 'text-[var(--color-ivory)]' : 'text-[var(--color-mist)]'}`}>{title}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
          <span>{relationLabel}</span>
          {formatLabel ? <span>{formatLabel}</span> : null}
          {anime.seasonYear ? <span>{anime.seasonYear}</span> : null}
          {anime.episodes ? <span>{anime.episodes} eps</span> : null}
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
    const startedAt = Date.now();
    setLoading(true);
    setError('');
    setAnime(null);

    anilistRequest(ANIME_DETAILS_QUERY, { id: Number.parseInt(id, 10) }, {
      cacheTtlMs: 5 * 60 * 1000,
      key: `anime-details:${id}`,
    })
      .then((data) => {
        if (cancelled) return;
        if (!data?.Media) throw new Error('Anime not found');
        setAnime(data.Media);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError.message || 'Failed to load anime details');
      })
      .finally(async () => {
        await ensureMinimumDelay(startedAt);
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
      <main className="site-shell flex min-h-screen items-center justify-center px-4">
        <SurfacePanel className="px-6 py-5 text-sm text-[var(--color-muted)]">Missing anime id.</SurfacePanel>
      </main>
    );
  }

  if (loading) {
    return <AnimeDetailsSkeleton />;
  }

  if (error || !anime) {
    return (
      <main className="site-shell flex min-h-screen items-center justify-center px-4 py-10">
        <SurfacePanel className="w-full max-w-2xl p-6 sm:p-8">
          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">Detail Page</p>
          <h1 className="mt-3 font-[family:var(--font-display)] text-3xl text-[var(--color-ivory)] sm:text-4xl">Could not load this anime</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{error || 'Unknown error'}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/" className="button-primary">Go Home</Link>
            <Link href="/search" className="button-secondary">Search Anime</Link>
          </div>
        </SurfacePanel>
      </main>
    );
  }

  const title = mediaTitle(anime);
  const description = stripHtml(anime.description);
  const score = anime.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const seasonLabel = formatSeason(anime.season, anime.seasonYear);
  const saved = getProgress(anime.id);
  const watchLabel = saved?.episode > 1 ? `Continue from Episode ${saved.episode}` : 'Play Now';

  return (
    <main className="site-shell">
      <section className="relative overflow-hidden border-b border-white/6">
        <div className="absolute inset-0">
          {anime.bannerImage ? (
            <img src={anime.bannerImage} alt="" className="h-full w-full object-cover" />
          ) : anime.coverImage?.extraLarge ? (
            <img src={anime.coverImage.extraLarge} alt="" className="h-full w-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.35),rgba(8,10,14,0.95))]" />
          <div className="absolute inset-0 hidden sm:block bg-[radial-gradient(circle_at_20%_10%,rgba(196,160,96,0.18),transparent_28%),radial-gradient(circle_at_85%_15%,rgba(139,40,61,0.28),transparent_30%)]" />
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
                  className="aspect-[2/3] w-full rounded-xl border border-white/10 object-cover shadow-[0_8px_32px_rgba(0,0,0,0.38)]"
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
                <QuickActionLink href={watchHref(anime.id)} primary icon={RiPlayMiniFill}>
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

      <section className="mx-auto max-w-screen-xl space-y-10 px-4 py-8 sm:px-6">
        {watchSequence.length > 1 ? (
          <div>
            <SectionHeading eyebrow="Watch Order" title="Seasons & related entries" />
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {watchSequence.map((item, index) => (
                <SequenceCard key={item.id} anime={item} isCurrent={item.id === anime.id} index={index} />
              ))}
            </div>
          </div>
        ) : null}

        {recommendations.length ? (
          <div>
            <SectionHeading eyebrow="Recommended" title="You may also want to watch" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {recommendations.map((item) => (
                <MediaCard key={item.id} anime={item} />
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
