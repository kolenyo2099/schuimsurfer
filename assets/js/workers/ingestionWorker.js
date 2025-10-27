import { normalizePost } from '../normalization.js';

self.addEventListener('message', async (event) => {
  const { type } = event.data || {};
  if (type !== 'ingest') return;

  const { file, chunkSize = 500 } = event.data;
  if (!file) {
    self.postMessage({ type: 'error', message: 'No file provided to ingestion worker.' });
    return;
  }

  try {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let postsBuffer = [];

    const platformCounts = new Map();
    const seenUsers = new Set();
    const seenHashtags = new Set();

    let processed = 0;
    let totalEngagement = 0;
    let minTimestamp = Number.POSITIVE_INFINITY;
    let maxTimestamp = Number.NEGATIVE_INFINITY;

    const flushChunk = () => {
      if (postsBuffer.length === 0) return;
      const normalized = postsBuffer.map(normalizePost);
      postsBuffer = [];

      normalized.forEach((post) => {
        const platform = post.platform || 'unknown';
        platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);

        const userId = post.data?.author?.id;
        if (userId) seenUsers.add(userId);

        const hashtags = post.data?.challenges || [];
        hashtags.forEach((tag) => {
          if (tag?.title) seenHashtags.add(tag.title.toLowerCase());
        });

        const stats = post.data?.stats || {};
        totalEngagement += (stats.diggCount || 0) + (stats.commentCount || 0);

        const ts = post.data?.createTime;
        if (Number.isFinite(ts)) {
          if (ts < minTimestamp) minTimestamp = ts;
          if (ts > maxTimestamp) maxTimestamp = ts;
        }
      });

      processed += normalized.length;

      self.postMessage({
        type: 'chunk',
        posts: normalized,
        stats: {
          processed,
          posts: processed,
          uniqueUsers: seenUsers.size,
          uniqueHashtags: seenHashtags.size,
          averageEngagement: processed ? Math.round(totalEngagement / processed) : 0,
        },
      });
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            postsBuffer.push(parsed);
            if (postsBuffer.length >= chunkSize) {
              flushChunk();
            }
          } catch (err) {
            console.error('Failed to parse NDJSON line', err);
          }
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        postsBuffer.push(parsed);
      } catch (err) {
        console.error('Failed to parse trailing NDJSON line', err);
      }
    }

    flushChunk();

    self.postMessage({
      type: 'done',
      stats: {
        posts: processed,
        uniqueUsers: seenUsers.size,
        uniqueHashtags: seenHashtags.size,
        averageEngagement: processed ? Math.round(totalEngagement / processed) : 0,
      },
      platformCounts: Array.from(platformCounts.entries()),
      timeBounds: {
        min: Number.isFinite(minTimestamp) ? minTimestamp : null,
        max: Number.isFinite(maxTimestamp) ? maxTimestamp : null,
      },
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
});
