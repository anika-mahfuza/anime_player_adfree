'use client';

import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { SurfacePanel, TopNav } from '@/components/ui';

export function AppSkeletonTheme({ children }) {
  return (
    <SkeletonTheme
      baseColor="rgba(255,255,255,0.08)"
      highlightColor="rgba(255,255,255,0.16)"
      borderRadius="18px"
      duration={1.25}
    >
      {children}
    </SkeletonTheme>
  );
}

export function SkeletonBlock({ className = '', ...props }) {
  return <Skeleton containerClassName={className} {...props} />;
}

function PlaceholderPanel({ children, className = '' }) {
  return <SurfacePanel className={`overflow-hidden p-5 sm:p-6 ${className}`}>{children}</SurfacePanel>;
}

function PlaceholderSectionHeading() {
  return (
    <div className="mb-6">
      <SkeletonBlock className="mb-3 block max-w-[8rem]" height={10} />
      <SkeletonBlock className="mb-3 block max-w-[18rem]" height={34} />
      <SkeletonBlock className="block max-w-[28rem]" height={14} />
    </div>
  );
}

function MediaCardSkeleton() {
  return (
    <div className="media-card overflow-hidden">
      <div className="media-card-art">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="space-y-3 p-3.5 sm:p-4">
        <SkeletonBlock className="block" height={20} />
        <SkeletonBlock className="block max-w-[80%]" height={20} />
        <div className="flex gap-2">
          <SkeletonBlock className="block w-16" height={24} />
          <SkeletonBlock className="block w-20" height={24} />
        </div>
      </div>
    </div>
  );
}

function ContinueCardSkeleton() {
  return (
    <div className="media-card overflow-hidden">
      <div className="media-card-art">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="space-y-3 p-3.5 sm:p-4">
        <SkeletonBlock className="block max-w-[75%]" height={18} />
        <SkeletonBlock className="block max-w-[55%]" height={12} />
      </div>
    </div>
  );
}

export function ShelfSkeleton({ title, subtitle, cardCount = 5 }) {
  return (
    <section className="mx-auto max-w-screen-xl px-4 py-5 sm:px-6">
      <PlaceholderPanel>
        <div className="mb-6">
          {title ? <p className="mb-3 text-[0.7rem] uppercase tracking-[0.24em] text-[var(--color-brass)]">{title}</p> : null}
          <SkeletonBlock className="mb-3 block max-w-[18rem]" height={34} />
          {subtitle ? <p className="text-sm text-[var(--color-muted)]">{subtitle}</p> : <SkeletonBlock className="block max-w-[28rem]" height={14} />}
        </div>
        <div className="flex gap-3 overflow-hidden sm:gap-4">
          {Array.from({ length: cardCount }).map((_, index) => (
            <div key={index} className="rail-card">
              <MediaCardSkeleton />
            </div>
          ))}
        </div>
      </PlaceholderPanel>
    </section>
  );
}

export function MediaGridSkeleton({ count = 8, className = '' }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${className}`}>
      {Array.from({ length: count }).map((_, index) => (
        <MediaCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function ContinueRowSkeleton({ count = 6 }) {
  return (
    <section className="mx-auto max-w-screen-xl px-4 pt-6 sm:px-6">
      <PlaceholderPanel className="overflow-hidden p-5 sm:p-6">
        <PlaceholderSectionHeading />
        <div className="mt-6 flex gap-3 overflow-hidden sm:gap-4">
          {Array.from({ length: count }).map((_, index) => (
            <div key={index} className="rail-card">
              <ContinueCardSkeleton />
            </div>
          ))}
        </div>
      </PlaceholderPanel>
    </section>
  );
}

export function HomePageSkeleton() {
  return (
    <main className="site-shell">
      <section className="mx-auto max-w-screen-xl px-4 pt-7 sm:px-6 sm:pt-8">
        <SurfacePanel className="overflow-hidden p-0">
          <div className="grid min-h-[28rem] gap-5 p-4 sm:min-h-[34rem] sm:gap-6 sm:p-8 lg:grid-cols-[minmax(0,1.3fr)_22rem] lg:p-10">
            <div className="flex flex-col justify-end">
              <SkeletonBlock className="mb-4 block max-w-[8rem]" height={12} />
              <SkeletonBlock className="mb-3 block max-w-[28rem]" height={60} />
              <SkeletonBlock className="mb-3 block max-w-[26rem]" height={60} />
              <SkeletonBlock className="mb-2 block max-w-[38rem]" height={16} />
              <SkeletonBlock className="mb-5 block max-w-[32rem]" height={16} />
              <div className="mb-6 flex flex-wrap gap-2">
                <SkeletonBlock className="block w-28" height={30} />
                <SkeletonBlock className="block w-24" height={30} />
                <SkeletonBlock className="block w-32" height={30} />
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
                <SkeletonBlock className="block w-full sm:w-40" height={46} borderRadius={999} />
                <SkeletonBlock className="block w-full sm:w-40" height={46} borderRadius={999} />
              </div>
            </div>
            <div className="flex flex-col justify-end gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock key={index} className="block" height={84} borderRadius={22} />
              ))}
            </div>
          </div>
        </SurfacePanel>
      </section>

      <section className="mx-auto max-w-screen-xl px-4 pt-6 sm:px-6">
        <PlaceholderPanel>
          <PlaceholderSectionHeading />
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonBlock key={index} className="block w-24" height={30} borderRadius={999} />
              ))}
          </div>
        </PlaceholderPanel>
      </section>

      <section className="mx-auto max-w-screen-xl px-4 pt-6 sm:px-6">
        <PlaceholderPanel>
          <PlaceholderSectionHeading />
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rail-card">
                <ContinueCardSkeleton />
              </div>
            ))}
          </div>
        </PlaceholderPanel>
      </section>

      {Array.from({ length: 2 }).map((_, sectionIndex) => (
        <section key={sectionIndex} className="mx-auto max-w-screen-xl px-4 py-5 sm:px-6">
          <PlaceholderPanel>
            <PlaceholderSectionHeading />
            <div className="flex gap-3 overflow-hidden sm:gap-4">
              {Array.from({ length: 5 }).map((_, cardIndex) => (
                <div key={cardIndex} className="rail-card">
                  <MediaCardSkeleton />
                </div>
              ))}
            </div>
          </PlaceholderPanel>
        </section>
      ))}
    </main>
  );
}

export function SearchPageSkeleton() {
  return (
    <main className="site-shell">
      <section className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10">
        <PlaceholderPanel className="mb-8 px-4 py-5 sm:px-8 sm:py-8">
          <PlaceholderSectionHeading />
        </PlaceholderPanel>
        <MediaGridSkeleton />
      </section>
    </main>
  );
}

export function AnimeDetailsSkeleton() {
  return (
    <main className="site-shell">
      <section className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 sm:py-10">
        <SurfacePanel className="overflow-hidden p-5 sm:p-10">
          <div className="mb-8 flex gap-3">
            <SkeletonBlock className="block w-24" height={40} borderRadius={999} />
            <SkeletonBlock className="block w-24" height={40} borderRadius={999} />
          </div>
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-end lg:gap-8">
            <SkeletonBlock className="mx-auto block aspect-[2/3] w-full max-w-[15rem] sm:max-w-[19rem] lg:mx-0" />
            <div>
              <SkeletonBlock className="mb-3 block max-w-[8rem]" height={12} />
              <SkeletonBlock className="mb-3 block max-w-[30rem]" height={58} />
              <SkeletonBlock className="mb-6 block max-w-[18rem]" height={18} />
              <div className="mb-6 flex flex-wrap gap-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <SkeletonBlock key={index} className="block w-24" height={30} />
                ))}
              </div>
              <SkeletonBlock className="mb-2 block max-w-[40rem]" height={16} />
              <SkeletonBlock className="mb-2 block max-w-[38rem]" height={16} />
              <SkeletonBlock className="mb-2 block max-w-[35rem]" height={16} />
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:gap-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonBlock key={index} className="block w-full sm:w-20" height={28} borderRadius={999} />
                ))}
              </div>
              <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:gap-3">
                <SkeletonBlock className="block w-full sm:w-44" height={46} borderRadius={999} />
                <SkeletonBlock className="block w-full sm:w-40" height={46} borderRadius={999} />
              </div>
            </div>
          </div>
        </SurfacePanel>
      </section>

      <section className="mx-auto max-w-screen-xl space-y-8 px-4 py-2 sm:px-6 sm:pb-10">
        <PlaceholderPanel>
          <PlaceholderSectionHeading />
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonBlock key={index} className="block" height={108} borderRadius={24} />
            ))}
          </div>
        </PlaceholderPanel>
      </section>
    </main>
  );
}

export function ContinueWatchingSkeleton() {
  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Watch History</span>}
      >
        <div>
          <SkeletonBlock className="mb-2 block max-w-[7rem]" height={10} />
          <SkeletonBlock className="block max-w-[15rem]" height={32} />
        </div>
      </TopNav>
      <section className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10">
        <PlaceholderPanel className="mb-8 px-4 py-5 sm:px-8 sm:py-8">
          <PlaceholderSectionHeading />
        </PlaceholderPanel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <ContinueCardSkeleton key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}

export function WatchPageSkeleton() {
  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Player View</span>}
      >
        <div>
          <SkeletonBlock className="mb-2 block max-w-[8rem]" height={10} />
          <SkeletonBlock className="block max-w-[18rem]" height={32} />
        </div>
      </TopNav>

      <section className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.45fr)_24rem]">
          <div className="space-y-6">
            <PlaceholderPanel>
              <SkeletonBlock className="mb-4 block h-24 w-full sm:h-36" borderRadius={22} />
              <SkeletonBlock className="block aspect-video w-full" borderRadius={24} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <SkeletonBlock className="block w-32" height={42} borderRadius={999} />
                <SkeletonBlock className="order-first block w-full sm:order-none sm:w-32" height={16} />
                <SkeletonBlock className="block w-32" height={42} borderRadius={999} />
              </div>
            </PlaceholderPanel>

            <PlaceholderPanel>
              <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <SkeletonBlock className="mx-auto block h-48 w-32 sm:mx-0" borderRadius={24} />
                <div>
                  <SkeletonBlock className="mb-3 block max-w-[8rem]" height={10} />
                  <SkeletonBlock className="mb-3 block max-w-[24rem]" height={40} />
                  <div className="mb-4 flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <SkeletonBlock key={index} className="block w-24" height={30} />
                    ))}
                  </div>
                  <SkeletonBlock className="mb-2 block max-w-[40rem]" height={16} />
                  <SkeletonBlock className="mb-2 block max-w-[36rem]" height={16} />
                  <SkeletonBlock className="block max-w-[32rem]" height={16} />
                </div>
              </div>
            </PlaceholderPanel>
          </div>

          <div className="space-y-6">
            <PlaceholderPanel>
              <PlaceholderSectionHeading />
              <div className="space-y-2">
                {Array.from({ length: 7 }).map((_, index) => (
                  <SkeletonBlock key={index} className="block" height={68} borderRadius={20} />
                ))}
              </div>
            </PlaceholderPanel>

            <PlaceholderPanel>
              <PlaceholderSectionHeading />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonBlock key={index} className="block" height={74} borderRadius={20} />
                ))}
              </div>
            </PlaceholderPanel>
          </div>
        </div>
      </section>
    </main>
  );
}
