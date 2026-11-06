import { getPracticalVideos, videoContext } from '../lib/ask/practical-videos.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let body;
  try {
    if (Number(req.headers?.['content-length'] || 0) > 6000) throw new Error();
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body).length > 6000) throw new Error();
  } catch { return res.status(400).json({ error: 'INVALID_VIDEO_REQUEST' }); }
  const context = videoContext(body?.context);
  const language = body?.language;
  if (!context || !['en', 'es'].includes(language)) return res.status(400).json({ error: 'INVALID_VIDEO_REQUEST' });
  const videos = await getPracticalVideos(context, language);
  return res.status(200).json({ language, videos });
}
