'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { RiSearchEyeLine, RiSparkling2Fill } from '@remixicon/react';
import { EmptyState, MediaCard, SearchField, SectionHeading, SurfacePanel, TopNav } from '@/components/ui';
import { MediaGridSkeleton, SearchPageSkeleton } from '@/components/skeletons';
import { anilistRequest, ensureMinimumDelay } from '@/lib/anilist';
import { searchJikanAnime } from '@/lib/jikan';
import { mediaTitle } from '@/lib/media';

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

function normalizeSearchTerm(term) {
  const text = String(term || '').trim();
  if (!text) return '';
  return text.replace(/\(.*?\bmal\D*\d{1,7}\b.*?\)/gi, '').trim() || text;
}

function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mediaIdentity(media, index = 0) {
  if (media?.id != null) return `id-${media.id}`;
  if (media?.idMal != null) return `mal-${media.idMal}`;
  const title = normalizeForCompare(mediaTitle(media));
  return title ? `title-${title}` : `idx-${index}`;
}

function scoreSearchMatch(term, media) {
  const normalizedTerm = normalizeForCompare(term);
  if (!normalizedTerm) return 0;

  const titles = [
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    mediaTitle(media),
  ]
    .map(normalizeForCompare)
    .filter(Boolean);

  const primary = titles[0] || '';
  const words = normalizedTerm.split(' ').filter(Boolean);

  let score = 0;
  if (titles.includes(normalizedTerm)) score += 220;
  if (primary === normalizedTerm) score += 140;
  if (titles.some((value) => value.startsWith(normalizedTerm))) score += 95;
  if (titles.some((value) => value.includes(normalizedTerm))) score += 72;
  if (words.length > 0) {
    const matchedWords = words.filter((word) => titles.some((value) => value.includes(word))).length;
    score += matchedWords * 22;
  }
  if (media?.meanScore) score += Number(media.meanScore) / 100;
  return score;
}

function mergeAndRankResults(term, preferred = [], fallback = []) {
  const bucket = new Map();
  [...preferred, ...fallback].forEach((media, index) => {
    const identity = mediaIdentity(media, index);
    if (!bucket.has(identity)) {
      bucket.set(identity, media);
    }
  });

  return Array.from(bucket.values()).sort((a, b) => {
    const scoreDiff = scoreSearchMatch(term, b) - scoreSearchMatch(term, a);
    if (scoreDiff !== 0) return scoreDiff;
    const scoreTieBreak = Number(b?.meanScore || 0) - Number(a?.meanScore || 0);
    if (scoreTieBreak !== 0) return scoreTieBreak;
    return Number(b?.popularity || 0) - Number(a?.popularity || 0);
  });
}

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
    const normalizedTerm = normalizeSearchTerm(term);
    if (!normalizedTerm) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    const startedAt = Date.now();
    try {
      let aniListResults = [];
      let aniListTotal = 0;

      const data = await anilistRequest(SEARCH_QUERY, { s: normalizedTerm, page: 1 }, {
        cacheTtlMs: 60 * 1000,
        key: `search:${normalizedTerm.toLowerCase()}:1`,
      });
      const media = (data?.Page?.media || []).filter((item) => item.id || item.idMal);
      aniListResults = Array.from(
        new Map(media.map((item, index) => [mediaIdentity(item, index), item])).values()
      );
      aniListTotal = data?.Page?.pageInfo?.total ?? aniListResults.length;

      const fallback = await searchJikanAnime(term, {
        page: 1,
        limit: 24,
        key: `search:jikan:${term.trim().toLowerCase()}:1`,
      });
      const merged = mergeAndRankResults(normalizedTerm, aniListResults, fallback.media || []);
      setResults(merged);
      setTotal(Math.max(aniListTotal, fallback.total || 0, merged.length));
    } catch {
      try {
        const fallback = await searchJikanAnime(term, {
          page: 1,
          limit: 24,
          key: `search:jikan:${term.trim().toLowerCase()}:1`,
        });
        const rankedFallback = mergeAndRankResults(normalizedTerm, [], fallback.media || []);
        setResults(rankedFallback);
        setTotal(Math.max(fallback.total || 0, rankedFallback.length));
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
