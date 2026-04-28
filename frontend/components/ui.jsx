'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBookmark3Fill,
  RiClapperboardLine,
  RiCloseLine,
  RiCompass3Line,
  RiFireFill,
  RiPlayMiniFill,
  RiSearchLine,
  RiSparkling2Fill,
  RiStarFill,
  RiTimeLine,
  RiTv2Line,
} from '@remixicon/react';
import { animeHref } from '@/lib/routes';
import { formatStatus, mediaTitle } from '@/lib/media';

export function cx(...values) {
  return values.filter(Boolean).join(' ');
}

export function BrandMark({ compact = false }) {
  return (
    <Link href="/" className="inline-flex max-w-full items-center gap-2.5 sm:gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[rgba(139,40,61,0.9)]">
        <Image src="/logo.png" alt="AniStream" width={88} height={88} className="h-full w-full object-contain" />
      </div>
      <span className="min-w-0 flex flex-col leading-none">
        <span className="truncate font-[family:var(--font-display)] text-[0.92rem] tracking-[0.15em] text-[var(--color-mist)] uppercase">
          AniStream
        </span>
        {!compact && (
          <span className="mt-1 hidden text-[0.7rem] uppercase tracking-[0.26em] text-[var(--color-muted)] sm:block">
            Curated Anime Cinema
          </span>
        )}
      </span>
    </Link>
  );
}

export function TopNav({ children, rightSlot, backHref, backLabel = 'Back' }) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/6 bg-[rgba(8,10,14,0.95)] md:bg-[rgba(8,10,14,0.78)] md:backdrop-blur-2xl">
      <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-6 sm:py-4">
        {backHref ? (
          <Link href={backHref} className="button-ghost shrink-0 px-2.5 py-2 sm:px-4">
            <RiArrowLeftSLine size={18} />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        ) : (
          <BrandMark compact />
        )}
        <div className="min-w-0 basis-full flex-1 sm:basis-auto">{children}</div>
        {rightSlot ? <div className="hidden shrink-0 items-center gap-3 lg:flex">{rightSlot}</div> : null}
      </div>
    </header>
  );
}

export function SearchField({
  value,
  onChange,
  onSubmit,
  onClear,
  loading = false,
  placeholder = 'Search anime...',
  autoFocus = false,
  className = '',
}) {
  return (
    <form onSubmit={onSubmit} className={cx('relative', className)}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] sm:left-4">
          <RiSearchLine size={18} className={loading ? 'animate-pulse' : ''} />
        </span>
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="lux-input w-full pl-10 pr-10 sm:pl-11 sm:pr-11"
        />
        {value ? (
          <button type="button" onClick={onClear} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--color-muted)] transition hover:bg-white/6 hover:text-[var(--color-mist)]">
            <RiCloseLine size={16} />
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function SurfacePanel({ className = '', children }) {
  return <section className={cx('surface-panel', className)}>{children}</section>;
}

export function SectionHeading({ eyebrow, title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 inline-flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.24em] text-[var(--color-brass)]">
            <RiSparkling2Fill size={14} />
            {eyebrow}
          </div>
        ) : null}
      <h2 className="font-[family:var(--font-display)] text-[1.25rem] leading-tight text-[var(--color-ivory)] sm:text-[1.5rem]">
        {title}
      </h2>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">{action}</div> : null}
    </div>
  );
}

export function MetaPill({ icon: Icon, children, accent = 'var(--color-mist)', className = '' }) {
  return (
    <span className={cx('meta-pill', className)}>
      {Icon ? <Icon size={14} style={{ color: accent }} /> : null}
      {children}
    </span>
  );
}

export function TagChip({ children, className = '' }) {
  return <span className={cx('tag-chip', className)}>{children}</span>;
}

export function StatusBadge({ status, className = '' }) {
  if (!status) return null;

  const normalized = formatStatus(status);
  const tone =
    status === 'RELEASING'
      ? 'bg-[rgba(139,40,61,0.24)] text-[var(--color-ivory)] border-[rgba(183,82,106,0.45)]'
      : status === 'FINISHED'
        ? 'bg-[rgba(196,160,96,0.15)] text-[var(--color-brass)] border-[rgba(196,160,96,0.28)]'
        : 'bg-white/5 text-[var(--color-mist)] border-white/10';

  return <span className={cx('status-badge', tone, className)}>{normalized}</span>;
}

export function EmptyState({ icon: Icon = RiCompass3Line, title, description, action }) {
  return (
    <SurfacePanel className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[var(--color-brass)]">
        <Icon size={24} />
      </span>
      <h2 className="font-[family:var(--font-display)] text-[2rem] text-[var(--color-ivory)] sm:text-3xl">{title}</h2>
      {description ? <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted)]">{description}</p> : null}
      {action ? <div className="mt-7">{action}</div> : null}
    </SurfacePanel>
  );
}

export function MediaCard({ anime, href, compact = false, priority = false, className = '' }) {
  const title = mediaTitle(anime);
  const image = anime?.coverImage?.extraLarge ?? anime?.coverImage?.large ?? anime?.coverImage?.medium;
  const score = anime?.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const episodes = anime?.nextAiringEpisode?.episode
    ? `EP ${anime.nextAiringEpisode.episode - 1}`
    : anime?.episodes
      ? `${anime.episodes} eps`
      : null;
  const format = anime?.format ? anime.format.replace(/_/g, ' ') : null;
  const destination = href || animeHref(anime?.id);

  return (
    <Link href={destination} className={cx('media-card group max-w-full', compact ? 'media-card-compact' : '', className)}>
      <div className="media-card-art">
        {image ? (
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--color-ink)] text-[var(--color-muted)]">
            <RiTv2Line size={compact ? 28 : 34} />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.04),rgba(8,10,14,0.9))]" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2.5 sm:p-3">
          {score ? (
            <MetaPill icon={RiStarFill} accent="var(--color-brass)" className="bg-[rgba(8,10,14,0.6)]">
              {score}
            </MetaPill>
          ) : <span />}
          {episodes ? <MetaPill icon={RiTimeLine}>{episodes}</MetaPill> : null}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5 sm:p-3">
          <div className="flex gap-2">
            {format ? <TagChip>{format}</TagChip> : null}
            {anime?.status === 'RELEASING' ? <StatusBadge status={anime.status} /> : null}
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-[rgba(8,10,14,0.56)] text-[var(--color-ivory)] transition duration-300 group-hover:bg-[rgba(139,40,61,0.92)] sm:h-11 sm:w-11">
            <RiPlayMiniFill size={18} className="translate-x-[1px] sm:text-[20px]" />
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-2 text-[0.82rem] font-medium leading-5 text-[var(--color-ivory)] transition group-hover:text-white">
          {title}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(anime?.genres || []).slice(0, compact ? 1 : 2).map((genre) => (
            <TagChip key={genre} className="text-[0.58rem]">
              {genre}
            </TagChip>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function HeroMetaRow({ anime }) {
  const score = anime?.meanScore ? (anime.meanScore / 10).toFixed(1) : null;
  const format = anime?.format ? anime.format.replace(/_/g, ' ') : null;
  const episodes = anime?.episodes ? `${anime.episodes} episodes` : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {score ? <MetaPill icon={RiStarFill} accent="var(--color-brass)">{score} rating</MetaPill> : null}
      {format ? <MetaPill icon={RiClapperboardLine}>{format}</MetaPill> : null}
      {episodes ? <MetaPill icon={RiTv2Line}>{episodes}</MetaPill> : null}
      {anime?.status ? <StatusBadge status={anime.status} /> : null}
    </div>
  );
}

export function QuickActionLink({ href, primary = false, icon: Icon = RiArrowRightSLine, children }) {
  return (
    <Link href={href} className={primary ? 'button-primary w-full sm:w-auto' : 'button-secondary w-full sm:w-auto'}>
      {Icon ? <Icon size={18} /> : null}
      {children}
    </Link>
  );
}

export function ContinueBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(196,160,96,0.24)] bg-[rgba(196,160,96,0.1)] px-3 py-1 text-[0.7rem] uppercase tracking-[0.16em] text-[var(--color-brass)]">
      <RiBookmark3Fill size={13} />
      {children}
    </span>
  );
}

export const UiIcons = {
  arrowLeft: RiArrowLeftSLine,
  arrowRight: RiArrowRightSLine,
  compass: RiCompass3Line,
  fire: RiFireFill,
  play: RiPlayMiniFill,
  search: RiSearchLine,
  sparkle: RiSparkling2Fill,
  star: RiStarFill,
  time: RiTimeLine,
  tv: RiTv2Line,
};
