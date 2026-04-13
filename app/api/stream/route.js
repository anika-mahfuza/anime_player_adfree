import { NextResponse } from 'next/server';
import axios from 'axios';

const ANITAKU = 'https://anitaku.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const AX = axios.create({ 
  timeout: 15_000, 
  headers: { 
    'User-Agent': UA,
    'Referer': ANITAKU
  } 
});

function normalizeSearchText(value) {
  return (value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    // Remove decorative brackets often present in titles like 【OSHI NO KO】
    .replace(/[【】「」『』《》〈〉（）\[\]{}]/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSeasonPart(value) {
  return value
    .replace(/\bseason\s*\d+\b/ig, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/ig, '')
    .replace(/\bpart\s*\d+\b/ig, '')
    .replace(/\bcour\s*\d+\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asciiWords(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchAnitaku(title) {
  console.log(`[stream] Searching Anitaku: "${title}"`);
  
  // Build search variations - handle movies and special titles
  const titleNormalized = normalizeSearchText(title);

  const titleClean = titleNormalized
    .replace(/[–—:-]/g, ' ')
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleNoSeasonPart = stripSeasonPart(titleClean);
  const titleAscii = asciiWords(titleClean);
  const titleNoSeasonAscii = asciiWords(titleNoSeasonPart);

  const apostropheVariants = [
    titleClean,
    titleClean.replace(/'/g, ''),
    titleNoSeasonPart,
    titleNoSeasonPart.replace(/'/g, ''),
    titleAscii,
    titleNoSeasonAscii,
  ].filter(Boolean);
  
  // Extract year pattern and handle it separately
  let yearMatch = titleClean.match(/\b(19\d{2}|20\d{2})\b/);
  let year = yearMatch ? yearMatch[1] : null;
  let titleWithoutYear = titleClean;
  if (year) {
    titleWithoutYear = titleClean.split(year)[0].trim() + titleClean.split(year).slice(1).join(' ').trim();
    titleWithoutYear = titleWithoutYear.replace(/\s+/g, ' ').trim();
  }
  
  // Extract main title (before "Movie", "Season", etc.)
  const mainTitleMatch = titleWithoutYear.match(/^([^:]*(?:Season|Part|Part \d+)?)/i);
  const mainTitle = mainTitleMatch ? mainTitleMatch[1].trim() : titleWithoutYear;
  
  // Generate variations
  const searchVariations = [
    ...apostropheVariants,
    titleWithoutYear,
    mainTitle,
    titleClean.replace(/The Movie:?/i, '').trim(),
    titleClean.replace(/Movie:?/i, '').trim(),
    titleNoSeasonPart,
    stripSeasonPart(titleWithoutYear),
    asciiWords(titleWithoutYear),
    asciiWords(mainTitle),
  ];
  
  // Add year variations
  if (year) {
    searchVariations.push(
      `${mainTitle} ${year}`,
      mainTitle.split(' ').slice(0, 2).join(' ') + ' ' + year,
    );
  }
  
  // Add word variations
  const baseWordSource = titleNoSeasonAscii || titleAscii || asciiWords(mainTitle);
  const baseWords = baseWordSource.split(' ').filter(Boolean);
  searchVariations.push(
    mainTitle.split(' ').slice(0, 3).join(' '),
    mainTitle.split(' ').slice(0, 2).join(' '),
    mainTitle.split(' ').slice(0, 1).join(' '),
    baseWords.slice(0, 4).join(' '),
    baseWords.slice(0, 3).join(' '),
    baseWords.slice(0, 2).join(' '),
  );
  
  const uniqueVariations = [...new Set(searchVariations.map(normalizeSearchText).filter(v => v.length > 2))];
  
  for (const searchTerm of uniqueVariations) {
    try {
      const { data } = await AX.get(`${ANITAKU}/search.html?keyword=${encodeURIComponent(searchTerm)}`);
      
      const allMatches = data.match(/href="\/category\/([^"]+)"/g) || [];
      console.log(`[stream] Search "${searchTerm.substring(0,30)}...": ${allMatches.length} categories`);
      
      if (allMatches.length === 0) continue;
      
      // Extract key words from original title for matching
      const keyWords = (titleNoSeasonAscii || titleAscii || asciiWords(searchTerm))
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 5);
      
      for (const m of allMatches) {
        const slug = m.match(/href="\/category\/([^"]+)"/)[1];
        const slugLower = slug.toLowerCase();
        
        // Check if slug contains any key words
        const hasMatch = keyWords.some(kw => slugLower.includes(kw));
        if (hasMatch) {
          console.log(`[stream] Matched "${slug}" via keyword`);
          return slug;
        }
        
        // Check starts with first keyword
        if (keyWords.length > 0 && slugLower.startsWith(keyWords[0])) {
          console.log(`[stream] Matched "${slug}" via prefix`);
          return slug;
        }
      }
      
      // Return first match as fallback
      const firstSlug = allMatches[0].match(/href="\/category\/([^"]+)"/)[1];
      console.log(`[stream] Fallback: ${firstSlug}`);
      return firstSlug;
      
    } catch (e) {
      console.log(`[stream] Search variation failed: ${e.message}`);
    }
  }
  
  return null;
}

async function getEpisodeSlug(animeSlug, episodeNum) {
  console.log(`[stream] Getting episode ${episodeNum} for ${animeSlug}`);
  
  // Direct episode URL pattern - use full anime slug
  const episodeUrl = `/${animeSlug}-episode-${episodeNum}`;
  console.log(`[stream] Trying: ${episodeUrl}`);
  
  try {
    const { data } = await AX.get(`${ANITAKU}${episodeUrl}`);
    if (data.includes('data-video') || data.includes('server-video')) {
      console.log(`[stream] Episode found: ${episodeUrl}`);
      return episodeUrl;
    }
  } catch (e) {
    console.log(`[stream] Direct episode URL failed: ${e.message}`);
  }
  
  // Try category page for episodes
  try {
    const { data: catData } = await AX.get(`${ANITAKU}/category/${animeSlug}`);
    const epMatch = catData.match(new RegExp(`href="(/[^"]+-episode-${episodeNum})"`, 'i'));
    if (epMatch) {
      console.log(`[stream] Found on category page: ${epMatch[1]}`);
      return epMatch[1];
    }
  } catch (e) {
    console.log(`[stream] Category page failed: ${e.message}`);
  }
  
  return null;
}

async function getVideoServers(episodeSlug) {
  console.log(`[stream] Getting video servers for ${episodeSlug}`);
  
  const url = `${ANITAKU}${episodeSlug}`;
  console.log(`[stream] Fetching: ${url}`);
  
  const { data } = await AX.get(url);
  
  console.log(`[stream] Page size: ${data.length}`);
  console.log(`[stream] Has server-video: ${data.includes('server-video')}`);
  console.log(`[stream] Has data-video: ${data.includes('data-video')}`);
  console.log(`[stream] Has vibeplayer: ${data.includes('vibeplayer')}`);
  
  // Try different patterns
  let serverMatches = data.match(/data-video="([^"]+)"/g) || [];
  console.log(`[stream] data-video matches: ${serverMatches.length}`);
  
  if (serverMatches.length === 0) {
    serverMatches = data.match(/data-video='([^']+)'/g) || [];
    console.log(`[stream] data-video single-quote matches: ${serverMatches.length}`);
  }
  
  if (serverMatches.length === 0) {
    serverMatches = data.match(/data-video=\s*"([^"]+)"/g) || [];
    console.log(`[stream] data-video spaced matches: ${serverMatches.length}`);
  }
  
  const servers = serverMatches.map(m => {
    const cleaned = m.replace(/data-video["']?\s*[:=]\s*["']?/, '').replace(/["']$/, '');
    return cleaned;
  });
  
  console.log(`[stream] Found ${servers.length} servers`);
  return servers;
}

async function extractM3u8FromUrl(videoUrl) {
  console.log(`[stream] Extracting from: ${videoUrl}`);
  try {
    const { data } = await AX.get(videoUrl);
    
    // Try m3u8 link directly in page
    const m3u8Match = data.match(/https:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (m3u8Match && m3u8Match[0]) {
      return m3u8Match[0];
    }
    
    // Try src="*.m3u8" pattern
    const srcMatch = data.match(/src\s*=\s*"([^"]*\.m3u8[^"]*)"/);
    if (srcMatch && srcMatch[1]) {
      return srcMatch[1];
    }
    
    // Try data-src attribute
    const dataSrcMatch = data.match(/data-src\s*=\s*"([^"]*\.m3u8[^"]*)"/);
    if (dataSrcMatch && dataSrcMatch[1]) {
      return dataSrcMatch[1];
    }
    
    // Try player.src({ src: "*.m3u8" pattern
    const playerSrcMatch = data.match(/player\.src\([^)]*src\s*:\s*"([^"]+)"/);
    if (playerSrcMatch && playerSrcMatch[1]) {
      return playerSrcMatch[1];
    }
  } catch (e) {
    console.warn(`[stream] Extraction failed: ${e.message}`);
  }
  return null;
}

async function getStreamsbDirect(streamSbUrl) {
  console.log(`[stream] Getting StreamSB direct: ${streamSbUrl}`);
  try {
    // StreamSB typically needs special headers
    const streamAX = axios.create({
      timeout: 15_000,
      headers: {
        'User-Agent': UA,
        'Referer': streamSbUrl,
        'Origin': 'https://streamsb.net',
      }
    });
    
    const { data } = await streamAX.get(streamSbUrl);
    
    // Look for hls or mp4 links
    const hlsMatch = data.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
    if (hlsMatch) {
      return hlsMatch[1];
    }
    
    // Try to find video src
    const videoSrcMatch = data.match(/source\s+src\s*=\s*["']([^"']+)["']/);
    if (videoSrcMatch) {
      return videoSrcMatch[1];
    }
  } catch (e) {
    console.warn(`[stream] StreamSB failed: ${e.message}`);
  }
  return null;
}

async function getDoodStream(doodUrl) {
  console.log(`[stream] Getting Dood stream: ${doodUrl}`);
  try {
    const { data } = await AX.get(doodUrl);
    // Dood often has CDN links in the page
    const match = data.match(/(https?:\/\/[^"']+dood\.so[^"']*)/);
    if (match) {
      return match[1];
    }
  } catch (e) {
    console.warn(`[stream] Dood failed: ${e.message}`);
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title')?.trim();
  const altTitles = (searchParams.get('altTitles') || '')
    .split('|')
    .map(t => t.trim())
    .filter(Boolean);
  const episode = searchParams.get('episode')?.trim() || '1';

  if (!title) {
    return NextResponse.json({ error: 'Missing param: title' }, { status: 400 });
  }

  console.log(`\n[stream] ══ "${title}" ep ${episode} ══`);

  try {
    const candidateTitles = [...new Set([title, ...altTitles])];
    let animeSlug = null;
    let matchedTitle = null;

    for (const candidateTitle of candidateTitles) {
      animeSlug = await searchAnitaku(candidateTitle);
      if (animeSlug) {
        matchedTitle = candidateTitle;
        break;
      }
    }

    if (!animeSlug) throw new Error(`No results for "${title}"`);
    if (matchedTitle && matchedTitle !== title) {
      console.log(`[stream] Matched using alternate title: "${matchedTitle}"`);
    }
    
    const episodeSlug = await getEpisodeSlug(animeSlug, episode);
    if (!episodeSlug) throw new Error(`Episode ${episode} not found`);
    
    const servers = await getVideoServers(episodeSlug);
    if (!servers.length) throw new Error('No video servers found');
    
    // Try multiple servers - prefer higher quality ones
    const serverPriority = ['streamsb', 'streamshide', 'vibeplayer', 'dood', 'mixdrop'];
    
    // Sort servers by priority
    const sortedServers = [...servers].sort((a, b) => {
      const aIdx = serverPriority.findIndex(p => a.includes(p));
      const bIdx = serverPriority.findIndex(p => b.includes(p));
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

    console.log(`[stream] Sorted servers: ${sortedServers.slice(0, 5).join(', ')}`);
    
    let m3u8Url = null;
    let usedServer = null;
    
    for (const server of sortedServers) {
      console.log(`[stream] Trying server: ${server}`);
      
      // Try StreamSB first (often better quality)
      if (server.includes('streamsb') || server.includes('streamshide')) {
        m3u8Url = await getStreamsbDirect(server);
        if (m3u8Url) {
          console.log(`[stream] ✓ Got m3u8 from StreamSB: ${m3u8Url.slice(0, 80)}...`);
          usedServer = 'streamsb';
          break;
        }
      }
      
      // Try Dood
      if (server.includes('dood')) {
        m3u8Url = await getDoodStream(server);
        if (m3u8Url) {
          console.log(`[stream] ✓ Got stream from Dood`);
          usedServer = 'dood';
          break;
        }
      }
      
      // Try VibePlayer
      if (server.includes('vibeplayer.site')) {
        m3u8Url = await extractM3u8FromUrl(server);
        if (m3u8Url) {
          console.log(`[stream] ✓ Got m3u8 from VibePlayer`);
          usedServer = 'vibeplayer';
          break;
        }
      }
      
      // Try other direct m3u8 sources
      if (server.includes('.m3u8')) {
        m3u8Url = server;
        console.log(`[stream] ✓ Direct m3u8: ${server}`);
        usedServer = 'direct';
        break;
      }
    }
    
    if (!m3u8Url) {
      throw new Error('Could not extract video URL');
    }

    const origin = new URL(request.url).origin;
    const proxyUrl = `${origin}/api/hls?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://vibeplayer.site')}`;
    return NextResponse.json({ streamUrl: proxyUrl });
  } catch (err) {
    console.error('[stream] ❌', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}