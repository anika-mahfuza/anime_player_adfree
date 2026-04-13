import { NextResponse } from 'next/server';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const cache = new Map();
const CACHE_CLEANUP = 300000; // 5 minutes
const MAX_CACHE_SIZE = 100;

function getCacheKey(query, variables) {
  return JSON.stringify({ query, variables });
}

function getCacheTTL(query) {
  if (query.includes('mutation')) return 0;
  if (query.includes('Page')) return CACHE_CLEANUP;
  if (query.includes('search')) return CACHE_CLEANUP;
  return 180000; // 3 min for single items
}

export async function POST(request) {
  try {
    const { query, variables } = await request.json();
    
    const cacheKey = getCacheKey(query, variables);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return NextResponse.json(cached.data, { 
        headers: { ...CORS, 'X-Cache': 'HIT' }
      });
    }
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    
    const data = await response.json();
    
    if (response.ok && !data.errors) {
      const ttl = getCacheTTL(query);
      if (ttl > 0) {
        if (cache.size >= MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        cache.set(cacheKey, { data, expiry: Date.now() + ttl });
      }
    }
    
    return NextResponse.json(data, { 
      headers: { ...CORS, 'X-Cache': 'MISS' }
    });
  } catch (err) {
    console.error('AniList proxy error:', err.message);
    return NextResponse.json({ errors: [{ message: err.message }] }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now >= value.expiry) cache.delete(key);
  }
}, 60000);