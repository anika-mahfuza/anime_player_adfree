'use client';

import Link from 'next/link';
import { RiAlertLine, RiHome5Line, RiRefreshLine, RiSearchLine } from '@remixicon/react';
import { EmptyState, SurfacePanel } from '@/components/ui';

export default function Error({ error, reset }) {
  return (
    <main className="site-shell flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <SurfacePanel className="overflow-hidden p-6 sm:p-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[rgba(183,82,106,0.35)] bg-[rgba(139,40,61,0.18)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-ivory)]">
            <RiAlertLine size={14} />
            Runtime Interruption
          </div>
          <EmptyState
            icon={RiAlertLine}
            title="This page hit an unexpected error."
            description="Try the page again, go back to the homepage, or search directly for the anime you were looking for."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <button onClick={reset} className="button-primary">
                  <RiRefreshLine size={18} />
                  Try Again
                </button>
                <Link href="/" className="button-secondary">
                  <RiHome5Line size={18} />
                  Home
                </Link>
                <Link href="/search" className="button-secondary">
                  <RiSearchLine size={18} />
                  Search
                </Link>
              </div>
            }
          />

          {error?.message ? (
            <div className="mt-8 rounded-[1.35rem] border border-white/8 bg-[rgba(8,10,14,0.5)] p-4 text-sm leading-6 text-[var(--color-muted)]">
              {error.message}
            </div>
          ) : null}
        </SurfacePanel>
      </div>
    </main>
  );
}
