const malId = 59708;
const endpoint = `https://api.ani.zip/mappings?mal_id=${malId}`;

function pickTitle(title) {
  if (!title || typeof title !== 'object') return null;
  return title.en || title['x-jat'] || title.ja || Object.values(title).find(Boolean) || null;
}

async function main() {
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AniZipTest/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`AniZip request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const episodes = Object.entries(payload?.episodes || {})
    .map(([key, value]) => {
      const number = Number.parseInt(String(value?.episode ?? key), 10);
      return {
        number,
        title: pickTitle(value?.title),
        airDate: value?.airDate || value?.airdate || null,
        runtime: value?.runtime || value?.length || null,
        image: value?.image || null,
      };
    })
    .filter((episode) => Number.isFinite(episode.number))
    .sort((a, b) => a.number - b.number);

  console.log(JSON.stringify({
    requestedMalId: malId,
    endpoint,
    mappings: payload?.mappings || null,
    episodeCount: payload?.episodeCount ?? episodes.length,
    episodes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
