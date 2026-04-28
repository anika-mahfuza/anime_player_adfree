'use client';

import Link from 'next/link';
import { RiCompass3Line, RiHome5Line, RiSearchLine } from '@remixicon/react';
import { EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="site-shell flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(196,160,96,0.28)] bg-[rgba(196,160,96,0.12)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-brass)]">
          <RiCompass3Line size={14} />
          404
        </div>
        <EmptyState
          icon={RiCompass3Line}
          title="That page does not exist."
          description="The link may have moved or the route may be broken."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/" className="button-primary">
                <RiHome5Line size={18} />
                Go Home
              </Link>
              <Link href="/search" className="button-secondary">
                <RiSearchLine size={18} />
                Search
              </Link>
            </div>
          }
        />
        <div className="mt-6 rounded-xl border border-white/8 bg-[rgba(8,10,14,0.5)] p-4">
          <p className="mb-3 text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-muted)]">Quick links</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/homepage" className="tag-chip">/homepage</Link>
            <Link href="/search" className="tag-chip">/search</Link>
            <Link href="/continue-watching" className="tag-chip">/continue-watching</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
