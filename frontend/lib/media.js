export function mediaTitle(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || 'Unknown';
}

export function formatStatus(status) {
  return {
    RELEASING: 'Airing',
    FINISHED: 'Finished',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED: 'Cancelled',
    HIATUS: 'On Hiatus',
  }[status] ?? status;
}

export function formatSeason(season, year) {
  if (!season && !year) return null;
  const normalizedSeason = season ? season[0] + season.slice(1).toLowerCase() : '';
  return [normalizedSeason, year].filter(Boolean).join(' ');
}

export function formatRelationType(relationType) {
  return {
    CURRENT: 'Current Season',
    PREQUEL: 'Prequel',
    SEQUEL: 'Sequel',
    SIDE_STORY: 'Side Story',
    SPIN_OFF: 'Spin-Off',
    ALTERNATIVE: 'Alternative',
    COMPILATION: 'Compilation',
    OTHER: 'Related',
  }[relationType] ?? 'Related';
}

export function stripHtml(text) {
  return text?.replace(/<[^>]+>/g, '') ?? '';
}
