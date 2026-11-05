import { LEARNING_TOPICS } from './report-presentation.js';

// Editorial allowlist: IDs copied from the publisher's own pages, never from a model.
// General professional demonstrations, not vehicle-specific instructions. Additions
// require source-page review and an applicability/safety review before release.
export const VIDEO_CATALOG = Object.freeze([
  { topic: 'obd_codes', videoId: '_qJymlwHcaU', language: 'en',
    title: 'Reading Diagnostic Trouble Codes', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/tutorials',
    scope: 'Professional scan-tool demonstration; controls differ from DriveShift.' },
  { topic: 'live_data', videoId: 'nYuBAGbwqVw', language: 'en',
    title: 'Using live data', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/tutorials',
    scope: 'Professional scan-tool demonstration; controls differ from DriveShift.' },
  { topic: 'starting_battery', videoId: 'YjUcN64aeoc', language: 'en',
    title: 'Solving a vehicle that is slow to start', publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-slow-start',
    scope: 'Professional slow-cranking case study; not confirmation of your vehicle’s fault.' },
  { topic: 'engine_misfire', videoId: 'o7trFoVZfeY', language: 'en',
    title: 'Solving a vehicle with a rough running engine and a check engine light on',
    publisher: 'Bosch Diagnostics',
    sourceUrl: 'https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-rough-running-engine-and-check-engine-light',
    scope: 'Professional case study; the same symptoms can have different causes.' },
]);

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
      for (const entry of VIDEO_CATALOG.filter(v => v.topic === topic && v.language === language).slice(0, 2)) {
        // Fixed Google host + curated ID: arbitrary user URLs cannot trigger SSRF.
        const url = `https://www.youtube.com/watch?v=${entry.videoId}`;
        const check = new URL('https://www.youtube.com/oembed');
        check.search = new URLSearchParams({ url, format: 'json' }).toString();
        try {
          const response = await fetchImpl(check.toString(), {
            signal: AbortSignal.timeout(2000), redirect: 'error',
          });
          if (!response.ok) continue;
          const metadata = await response.json();
          if (metadata.provider_name !== 'YouTube' || metadata.type !== 'video' || !metadata.title) continue;
          // Do not return/embed third-party HTML or thumbnail URLs. Link-out only.
          items.push({ videoId: entry.videoId, url, title: entry.title,
            publisher: entry.publisher, language, sourceUrl: entry.sourceUrl,
            scope: entry.scope, applicability: 'general_education',
            availabilityCheckedAt: new Date(now()).toISOString(),
          });
        } catch { /* Missing, removed, blocked, or slow videos are hidden. */ }
      }
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
