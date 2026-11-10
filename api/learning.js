import { getLearningVideos, isLearningTopic } from '../lib/ask/learning.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const topic = req.query?.topic;
  const language = req.query?.language ?? 'en';
  if (!isLearningTopic(topic) || !['en', 'es'].includes(language)) {
    return res.status(400).json({ error: 'INVALID_LEARNING_REQUEST' });
  }
  const videos = await getLearningVideos(topic, language);
  return res.status(200).json({ topic, language, videos,
    notice: language === 'es'
      ? 'Contenido educativo general; no confirma una avería ni sustituye una inspección.'
      : 'General educational content; not confirmation of a fault or a substitute for inspection.',
  });
}
