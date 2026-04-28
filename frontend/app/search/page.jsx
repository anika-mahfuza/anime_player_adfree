'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { RiSearchEyeLine } from '@remixicon/react';
import { EmptyState, MediaCard, SearchField, TopNav } from '@/components/ui';
import { MediaGridSkeleton, SearchPageSkeleton } from '@/components/skeletons';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';

const SEARCH_QUERY = `
query ($s: String, $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { total currentPage lastPage }
    media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
      idMal id title { romaji english } coverImage { extraLarge large }
      episodes meanScore status format genres
    }
  }
}`;

function SearchInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const timerRef = useRef(null);

  const doSearch = useCallback(async (term) => {
    if (!term.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    const startedAt = Date.now();
    try {
      const data = await anilistRequest(SEARCH_QUERY, { s: term, page: 1 }, {
        cacheTtlMs: 60 * 1000,
        key: `search:${term.trim().toLowerCase()}:1`,
      });
      const media = (data?.Page?.media || []).filter((item) => item.id);
      setResults(media);
      setTotal(data?.Page?.pageInfo?.total ?? media.length);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      await ensureMinimumDelay(startedAt, 450);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setQuery(initialQuery);
    doSearch(initialQuery);
  }, [initialQuery, doSearch]);

  const handleChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      router.replace(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : '/search', { scroll: false });
      doSearch(value);
    }, 420);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    clearTimeout(timerRef.current);
    router.replace(`/search?q=${encodeURIComponent(trimmed)}`);
    doSearch(trimmed);
  };

  const clearSearch = () => {
    clearTimeout(timerRef.current);
    setQuery('');
    setResults([]);
    setTotal(0);
    router.replace('/search');
  };

  return (
    <main className="site-shell">
      <TopNav
        backHref="/"
        backLabel="Home"
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">AniList Discovery</span>}
      >
        <SearchField
          value={query}
          onChange={handleChange}
          onSubmit={handleSubmit}
          onClear={clearSearch}
          loading={loading}
          placeholder="Search by title, mood, or season..."
          className="mx-auto max-w-2xl"
        />
      </TopNav>

      <section className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between border-b border-white/6 pb-4">
          <div>
            <h1 className="font-[family:var(--font-display)] text-lg text-[var(--color-ivory)] sm:text-xl">
              {query ? `Results for "${query}"` : 'Search the catalogue'}
            </h1>
            {query && total > 0 ? (
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{total}+ titles found</p>
            ) : null}
          </div>
        </div>

        {loading ? (
          <MediaGridSkeleton />
        ) : results.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {results.map((anime) => (
              <MediaCard key={anime.id} anime={anime} />
            ))}
          </div>
        ) : query ? (
          <EmptyState
            icon={RiSearchEyeLine}
            title="No matches for that search"
            description={`Try a shorter phrase, another title spelling, or browse from the homepage instead of “${query}”.`}
            action={<Link href="/" className="button-primary">Browse Homepage</Link>}
          />
        ) : (
          <EmptyState
            icon={RiSearchEyeLine}
            title="Start typing to search"
            description="Look up anime by name and jump straight into polished detail pages or your watch flow."
          />
        )}
      </section>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <SearchPageSkeleton />
      }
    >
      <SearchInner />
    </Suspense>
  );
}
