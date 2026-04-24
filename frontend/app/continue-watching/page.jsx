'use client';

import Link from 'next/link';
import { RiArrowLeftSLine, RiLoader4Line, RiPlayMiniFill, RiTimeLine, RiTv2Line } from '@remixicon/react';
import { ContinueBadge, EmptyState, SectionHeading, SurfacePanel, TopNav } from '@/components/ui';
import { ContinueWatchingSkeleton } from '@/components/skeletons';
import { useContinueWatching } from '@/hooks/useWatchProgress';
import { watchHref } from '@/lib/routes';

function ContinueGridCard({ item }) {
  const progress = item.totalEpisodes
    ? Math.min(100, Math.max(0, (item.episode / item.totalEpisodes) * 100))
    : 0;

  return (
    <Link href={watchHref(item.seasonId)} className="media-card group overflow-hidden">
      <div className="media-card-art">
        {item.coverImage ? (
          <img
            src={item.coverImage}
            alt={item.title || 'Anime cover'}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--color-ink)] text-[var(--color-muted)]">
            <RiTv2Line size={34} />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.12),rgba(8,10,14,0.9))]" />
        <div className="absolute inset-x-0 top-0 flex justify-between p-2.5 sm:p-3">
          <ContinueBadge>Continue</ContinueBadge>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-[rgba(8,10,14,0.56)] text-[var(--color-ivory)] transition duration-300 group-hover:bg-[rgba(139,40,61,0.92)] sm:h-11 sm:w-11">
            <RiPlayMiniFill size={18} className="translate-x-[1px]" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
          <div className="mb-2 flex items-center justify-between text-[0.68rem] uppercase tracking-[0.16em] text-[var(--color-mist)]">
            <span>Episode {item.episode}</span>
            <span>{item.totalEpisodes || '?'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-brass),var(--color-wine-bright))]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-3.5 sm:gap-3 sm:p-4">
        <div>
          <h2 className="line-clamp-2 text-[0.95rem] font-medium leading-6 text-[var(--color-ivory)] sm:text-base">{item.title}</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <RiTimeLine size={15} />
            Continue from episode {item.episode}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function ContinueWatchingPage() {
  const { items, loading, loadingMore, hasMore, loadMore } = useContinueWatching(20);

  if (loading && items.length === 0) {
    return <ContinueWatchingSkeleton />;
  }

  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Watch History</span>}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[var(--color-brass)]">Resume Library</p>
            <h1 className="mt-1 font-[family:var(--font-display)] text-xl text-[var(--color-ivory)] sm:text-3xl">
              Continue Watching
            </h1>
          </div>
        </div>
      </TopNav>

      <section className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10">
        <SurfacePanel className="mb-8 overflow-hidden px-4 py-5 sm:px-8 sm:py-8">
          <SectionHeading
            eyebrow="Personal Queue"
            title="Pick up right where you left off."
            subtitle="Your saved progress lives locally, so your recent episodes, resumed titles, and unfinished seasons stay one tap away."
            action={
              <Link href="/" className="button-secondary">
                <RiArrowLeftSLine size={18} />
                Back Home
              </Link>
            }
          />
        </SurfacePanel>
        {!loading && items.length === 0 ? (
          <EmptyState
            icon={RiTv2Line}
            title="No titles in progress yet"
            description="Once you start an episode, AniStream will keep your season and episode progress here for quick return trips."
            action={<Link href="/" className="button-primary">Browse Anime</Link>}
          />
        ) : null}

        {items.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <ContinueGridCard key={`${item.id || item.seasonId}-${item.episode || 0}`} item={item} />
              ))}
            </div>

            {hasMore ? (
              <div className="mt-8 flex justify-center">
                <button onClick={() => loadMore(12)} disabled={loadingMore} className="button-secondary">
                  {loadingMore ? <RiLoader4Line size={16} className="animate-spin" /> : null}
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
