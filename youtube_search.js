import ytSearch from 'yt-search';

/**
 * Search YouTube for tracks. Returns array of { title, artist, url, duration }
 */
export async function search(query, limit = 5) {
  const result = await ytSearch(query);

  if (!result.videos.length) return [];

  return result.videos.slice(0, limit).map((v) => {
    // yt-search v2 returns timestamp as string like "3:45" or seconds as number
    let durationMs = 0;
    if (typeof v.seconds === 'number') {
      durationMs = v.seconds * 1000;
    } else if (v.timestamp) {
      const parts = v.timestamp.split(':').map(Number);
      if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      else if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
    }
    return {
      title: v.title,
      artist: v.author.name,
      url: v.url,
      duration: durationMs,
    };
  });
}
