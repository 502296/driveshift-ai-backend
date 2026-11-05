import { LEARNING_TOPICS } from './report-presentation.js';

import { VIDEO_CATALOG } from './learning-catalog.js';
export { VIDEO_CATALOG } from './learning-catalog.js';

export function isLearningTopic(topic) {
  return typeof topic === 'string' && topic !== 'none' && LEARNING_TOPICS.includes(topic);
}

export function createLearningService({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function getLearningVideos(topic, language = 'en') {
    if (!isLearningTopic(topic) || !['en', 'es'].includes(language)) return [];
    const key = `${topic}:${language}`;
    const saved = cache.get(key);
    if (saved && saved.until > now()) return structuredClone(saved.items);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    const task = (async () => {
      const items = [];
      const checked = await Promise.all(VIDEO_CATALOG.filter(v => v.topic === topic && v.language === language).slice(0, 2).map(async entry => {
        // Fixed Google host + curated ID: arbitrary user URLs cannot trigger SSRF.
        const url = entry.platform === 'publisher' ? entry.url : `https://www.youtube.com/watch?v=${entry.videoId}`;
        const check = new URL('https://www.youtube.com/oembed');
        check.search = new URLSearchParams({ url, format: 'json' }).toString();
        try {
          const response = await fetchImpl(entry.platform === 'publisher' ? url : check.toString(), {
            ...(entry.platform === 'publisher' ? { method: 'HEAD' } : {}),
            signal: AbortSignal.timeout(2500), redirect: 'error',
          });
          if (!response.ok) return null;
          if (entry.platform === 'publisher') {
            if (!response.headers.get('content-type')?.toLowerCase().startsWith('video/mp4')) return null;
          } else {
            const metadata = await response.json();
            if (metadata.provider_name !== 'YouTube' || metadata.type !== 'video' || !metadata.title) return null;
          }
          // Do not return/embed third-party HTML or thumbnail URLs. Link-out only.
          return { videoId: entry.videoId, platform: entry.platform || 'youtube', url, title: entry.title,
            publisher: entry.publisher, language, sourceUrl: entry.sourceUrl,
            scope: entry.scope, applicability: 'general_education',
            availabilityCheckedAt: new Date(now()).toISOString(),
          };
        } catch { return null; /* Missing, removed, blocked, or slow videos are hidden. */ }
      }));
      items.push(...checked.filter(Boolean));
      // Cache is bounded by the fixed topic/language enums, with brief negative caching.
      cache.set(key, { until: now() + (items.length ? 15 * 60_000 : 30_000), items });
      return items;
    })();
    pending.set(key, task);
    try { return structuredClone(await task); }
    finally { pending.delete(key); }
  };
}

export const getLearningVideos = createLearningService();
