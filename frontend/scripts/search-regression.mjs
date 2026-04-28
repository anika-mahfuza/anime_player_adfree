import assert from 'node:assert/strict';
import { mergeAndRankMedia, parseUserSearchQuery } from '../lib/search.mjs';

const dataset = [
  {
    id: 1000,
    idMal: 30,
    title: { romaji: 'Shinseiki Evangelion', english: 'Neon Genesis Evangelion', native: '新世紀エヴァンゲリオン' },
    episodes: 26,
    meanScore: 84,
    popularity: 650000,
    format: 'TV',
    status: 'FINISHED',
  },
  {
    id: 1001,
    idMal: 63534,
    title: { romaji: 'Shinseiki Evangelion (Shinsaku Series)', english: 'Neon Genesis Evangelion (New Series)' },
    episodes: null,
    meanScore: null,
    popularity: 20000,
    format: 'TV',
    status: 'NOT_YET_RELEASED',
  },
  {
    id: 1002,
    idMal: 41084,
    title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' },
    episodes: 25,
    meanScore: 86,
    popularity: 800000,
    format: 'TV',
    status: 'FINISHED',
  },
];

function topResult(term, primary = dataset, fallback = []) {
  const queryInfo = parseUserSearchQuery(term);
  const merged = mergeAndRankMedia(queryInfo, primary, fallback);
  return { top: merged.results[0], debug: merged.debug };
}

function run() {
  const canonical = topResult('Neon Genesis Evangelion');
  assert.equal(canonical.top?.idMal, 30, 'canonical query should rank MAL 30 first');

  const withMalId = topResult('Neon Genesis Evangelion (MAL 30)');
  assert.equal(withMalId.top?.idMal, 30, 'MAL-id query should rank MAL 30 first');
  assert.equal(withMalId.debug?.malIdDetected, 30, 'parser should detect MAL ID');

  const alias = topResult('NGE');
  assert.equal(alias.top?.idMal, 30, 'alias query should resolve to Evangelion');

  const typo = topResult('evangleion');
  assert.equal(typo.top?.idMal, 30, 'typo query should still rank Evangelion first');
  assert.equal(Boolean(typo.debug?.fuzzyFallbackTriggered), true, 'typo query should trigger fuzzy fallback');

  console.log('search regression checks passed');
}

run();
