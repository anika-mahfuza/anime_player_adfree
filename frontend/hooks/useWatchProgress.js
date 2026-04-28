import { useState, useEffect, useCallback, useRef } from 'react';
import { ensureMinimumDelay, fetchAnimeMetadataBatch } from '@/lib/anilist';

const STORAGE_KEY = 'aniestream_progress';

function getStoredProgress() {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function setStoredProgress(data) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function useWatchProgress() {
  const progressRef = useRef(getStoredProgress());

  useEffect(() => {
    progressRef.current = getStoredProgress();
  }, []);

  const updateProgress = useCallback((animeId, data) => {
    const current = getStoredProgress();
    const updated = {
      ...current,
      [animeId]: { ...(current[animeId] || {}), ...data, updatedAt: Date.now() }
    };
    setStoredProgress(updated);
    progressRef.current = updated;
  }, []);

  const getProgress = useCallback((animeId) => {
    const latest = getStoredProgress();
    progressRef.current = latest;
    return latest[animeId] || null;
  }, []);

  const clearProgress = useCallback((animeId) => {
    const current = getStoredProgress();
    delete current[animeId];
    setStoredProgress(current);
    progressRef.current = current;
  }, []);

  return { updateProgress, getProgress, clearProgress };
}

function normalizeContinueItem(meta, data) {
  if (!meta?.id) return null;

  const episode = Number(data?.episode) || 1;
  const time = Number(data?.episodePositions?.[episode]) || 0;

  return {
    id: meta.id,
    seasonId: data.seasonId || meta.id,
    episode,
    time,
    totalEpisodes: meta.episodes || 1,
    title: meta.title?.english || meta.title?.romaji || 'Unknown',
    coverImage: meta.coverImage?.large,
  };
}

export function useContinueWatching(limit = 6) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadedIds = useRef(new Set());
  const loadingMoreRef = useRef(false);

  const buildSortedEntries = useCallback(() => {
    const stored = getStoredProgress();
    return Object.entries(stored)
      .filter(([id, v]) => Number.isFinite(Number.parseInt(id, 10)) && v?.episode > 0)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  }, []);

  const loadMore = useCallback(async (count = 4) => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const entries = buildSortedEntries();
      const remaining = entries.filter(([id]) => !loadedIds.current.has(id));
      const nextBatch = remaining.slice(0, count);

      if (nextBatch.length === 0) {
        setHasMore(false);
        return;
      }

      // Reserve ids immediately so double-clicks can't enqueue duplicates.
      nextBatch.forEach(([id]) => loadedIds.current.add(id));

      const metaList = await fetchAnimeMetadataBatch(nextBatch.map(([id]) => id));
      const metaById = new Map(metaList.map((item) => [String(item.id), item]));

      const valid = nextBatch
        .map(([id, data]) => {
          const meta = metaById.get(String(Number.parseInt(id, 10)));
          if (!meta) {
            loadedIds.current.delete(id);
            return null;
          }
          return normalizeContinueItem(meta, data);
        })
        .filter(Boolean);

      if (valid.length > 0) {
        setItems(prev => {
          const byId = new Map(prev.map(item => [item.id, item]));
          valid.forEach(item => byId.set(item.id, item));
          return Array.from(byId.values());
        });
      }

      const stillRemaining = buildSortedEntries().filter(([id]) => !loadedIds.current.has(id));
      setHasMore(stillRemaining.length > 0);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [buildSortedEntries]);

  useEffect(() => {
    const entries = buildSortedEntries();
    const startedAt = Date.now();
    
    const initial = entries.slice(0, limit);
    
    if (initial.length === 0) {
      ensureMinimumDelay(startedAt, 350).then(() => setLoading(false));
      return;
    }
    
    loadedIds.current = new Set();

    initial.forEach(([id]) => loadedIds.current.add(id));

    fetchAnimeMetadataBatch(initial.map(([id]) => id))
      .then(async (metaList) => {
        const metaById = new Map(metaList.map((item) => [String(item.id), item]));

        const validItems = initial
          .map(([id, data]) => {
            const meta = metaById.get(String(Number.parseInt(id, 10)));
            if (!meta) {
              loadedIds.current.delete(id);
              return null;
            }
            return normalizeContinueItem(meta, data);
          })
          .filter(Boolean);

        setItems(validItems);
        setHasMore(entries.length > limit);
        await ensureMinimumDelay(startedAt, 350);
        setLoading(false);
      })
      .catch(async () => {
        loadedIds.current = new Set();
        setItems([]);
        setHasMore(false);
        await ensureMinimumDelay(startedAt, 350);
        setLoading(false);
      });
  }, [limit, buildSortedEntries]);

  return { items, loading, loadingMore, hasMore, loadMore };
}

export function getWatchSequence(anime, relations) {
  if (!anime) return [];
  
  const KEEP_TYPES = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'COMPILATION', 'OTHER'];
  
  const allItems = [];
  const added = new Set();
  
  allItems.push({
    id: anime.id,
    title: anime.title,
    coverImage: anime.coverImage,
    seasonYear: anime.seasonYear,
    episodes: anime.episodes,
    status: anime.status,
    format: anime.format,
    relationType: 'CURRENT',
    isCurrent: true,
    type: 'current',
    order: 0
  });
  added.add(anime.id);
  
  const rels = relations?.edges || [];
  const sortedRels = rels
    .filter(e => KEEP_TYPES.includes(e.relationType) && e.node.type === 'ANIME')
    .sort((a, b) => (a.node.seasonYear || 9999) - (b.node.seasonYear || 9999));
  
  const prequels = sortedRels.filter(e => e.relationType === 'PREQUEL');
  prequels.forEach(e => {
    if (!added.has(e.node.id)) {
      allItems.unshift({
        id: e.node.id,
        title: e.node.title,
        coverImage: e.node.coverImage,
        seasonYear: e.node.seasonYear,
        episodes: e.node.episodes,
        status: e.node.status,
        format: e.node.format,
        isCurrent: false,
        type: 'prequel',
        relationType: e.relationType,
        order: -1
      });
      added.add(e.node.id);
    }
  });
  
  sortedRels.forEach(e => {
    if (!added.has(e.node.id)) {
      const order = e.node.seasonYear || 9999;
      allItems.push({
        id: e.node.id,
        title: e.node.title,
        coverImage: e.node.coverImage,
        seasonYear: e.node.seasonYear,
        episodes: e.node.episodes,
        status: e.node.status,
        format: e.node.format,
        isCurrent: false,
        type: e.relationType === 'SEQUEL' ? 'sequel' : 'side',
        relationType: e.relationType,
        order
      });
      added.add(e.node.id);
    }
  });
  
  return allItems;
}

export function formatSeasonLabel(items, currentId) {
  const index = items.findIndex(item => item.id === currentId);
  if (index === -1) return null;
  
  const total = items.length;
  if (total === 1) return null;
  
  return `Season ${index + 1} of ${total}`;
}
