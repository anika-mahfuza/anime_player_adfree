'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { RiSearchEyeLine, RiSparkling2Fill } from '@remixicon/react';
import { EmptyState, MediaCard, SearchField, SectionHeading, SurfacePanel, TopNav } from '@/components/ui';
import { MediaGridSkeleton, SearchPageSkeleton } from '@/components/skeletons';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';
import { hydrateMediaWithAniZipEpisodeCounts } from '@/lib/anizip';
import { searchJikanAnime } from '@/lib/jikan';
import { mediaIdentity, mergeAndRankMedia, parseUserSearchQuery } from '@/lib/search.mjs';

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
  const searchRunRef = useRef(0);

  const doSearch = useCallback(async (term) => {
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    const queryInfo = parseUserSearchQuery(term);
    if (!queryInfo.normalized) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    const startedAt = Date.now();
    try {
      let aniListResults = [];
      let aniListTotal = 0;

      const data = await anilistRequest(SEARCH_QUERY, { s: queryInfo.canonical, page: 1 }, {
        cacheTtlMs: 60 * 1000,
        key: `search:${queryInfo.normalized}:1`,
      });
      const media = (data?.Page?.media || []).filter((item) => item.id || item.idMal);
      aniListResults = Array.from(
        new Map(media.map((item, index) => [mediaIdentity(item, index), item])).values()
      );
      aniListTotal = data?.Page?.pageInfo?.total ?? aniListResults.length;

      const fallback = await searchJikanAnime(term, {
        page: 1,
        limit: 24,
        key: `search:jikan:${queryInfo.normalized}:1`,
      });
      const merged = mergeAndRankMedia(queryInfo, aniListResults, fallback.media || []);
      setResults(merged.results);
      setTotal(Math.max(aniListTotal, fallback.total || 0, merged.results.length));
      hydrateMediaWithAniZipEpisodeCounts(merged.results, {
        limit: 12,
        keyPrefix: `search:episodes:${queryInfo.normalized}`,
      }).then((hydrated) => {
        if (searchRunRef.current !== runId) return;
        setResults(hydrated);
      }).catch(() => {});
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[search] doSearch debug', merged.debug);
      }
    } catch {
      try {
        const fallback = await searchJikanAnime(term, {
          page: 1,
          limit: 24,
          key: `search:jikan:${queryInfo.normalized}:1`,
        });
        const merged = mergeAndRankMedia(queryInfo, [], fallback.media || []);
        setResults(merged.results);
        setTotal(Math.max(fallback.total || 0, merged.results.length));
        hydrateMediaWithAniZipEpisodeCounts(merged.results, {
          limit: 12,
          keyPrefix: `search:episodes:fallback:${queryInfo.normalized}`,
        }).then((hydrated) => {
          if (searchRunRef.current !== runId) return;
          setResults(hydrated);
        }).catch(() => {});
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[search] fallback-only debug', merged.debug);
        }
      } catch {
        setResults([]);
        setTotal(0);
      }
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
        rightSlot={<span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Anime Discovery</span>}
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

      <section className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10">
        <SurfacePanel className="mb-8 overflow-hidden px-4 py-5 sm:px-8 sm:py-8">
          <SectionHeading
            eyebrow="Search Archive"
            title={query ? `Results for “${query}”` : 'Search the catalogue'}
            subtitle={
              query
                ? `${total > 0 ? `${total}+ matches loaded` : 'No matches yet'} from the current catalogue feed.`
                : 'Type a title to explore polished anime cards, details pages, and the full watch flow.'
            }
            action={
              <div className="hidden items-center gap-2 text-sm text-[var(--color-muted)] md:flex">
                <RiSparkling2Fill size={16} className="text-[var(--color-brass)]" />
                Premium discovery mode
              </div>
            }
          />
        </SurfacePanel>

        {loading ? (
          <MediaGridSkeleton />
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
