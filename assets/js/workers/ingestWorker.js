import { normalizePost } from '../normalization.js';

let cancelRequested = false;
let activeReader = null;
let currentJobId = 0;

function summarizeStats({ postCount, userSet, hashtagSet, engagementSum }) {
  return {
    posts: postCount,
    users: userSet.size,
    hashtags: hashtagSet.size,
    engagement: postCount ? Math.round(engagementSum / postCount) : 0,
  };
}

self.addEventListener('message', async (event) => {
  const { type } = event.data || {};

  if (type === 'ingest') {
    if (!(event.data?.file instanceof File)) {
      self.postMessage({ type: 'error', message: 'Invalid file supplied to ingestion worker.' });
      return;
    }

    cancelRequested = false;
    currentJobId = typeof event.data.jobId === 'number' ? event.data.jobId : currentJobId + 1;
    try {
      await streamFile(event.data.file, event.data.batchSize || 500, currentJobId);
    } catch (err) {
      if (err?.name === 'AbortError') {
        self.postMessage({ type: 'cancelled', jobId: currentJobId });
      } else {
        self.postMessage({ type: 'error', jobId: currentJobId, message: err?.message || String(err) });
      }
    }
  } else if (type === 'cancel') {
    const cancelJobId = typeof event.data?.jobId === 'number' ? event.data.jobId : currentJobId;
    if (cancelJobId === currentJobId) {
      cancelRequested = true;
      if (activeReader) {
        try {
          await activeReader.cancel();
        } catch (err) {
          console.warn('Failed to cancel reader', err);
        }
      }
      self.postMessage({ type: 'cancelled', jobId: currentJobId });
    }
  }
});

async function streamFile(file, batchSize, jobId) {
  const decoder = new TextDecoder();
  let buffer = '';
  let batch = [];
  let postCount = 0;
  let engagementSum = 0;
  const userSet = new Set();
  const hashtagSet = new Set();
  const platformCounts = new Map();
  let minCreateTime = Number.POSITIVE_INFINITY;
  let maxCreateTime = Number.NEGATIVE_INFINITY;

  activeReader = file.stream().getReader();

  const flushBatch = () => {
    if (batch.length === 0 || cancelRequested || jobId !== currentJobId) return;
    self.postMessage({
      type: 'batch',
      jobId,
      posts: batch,
      stats: summarizeStats({ postCount, userSet, hashtagSet, engagementSum }),
      platformCounts: Object.fromEntries(platformCounts),
      processedPosts: postCount,
      minCreateTime: Number.isFinite(minCreateTime) ? minCreateTime : null,
      maxCreateTime: Number.isFinite(maxCreateTime) ? maxCreateTime : null,
    });
    batch = [];
  };

  try {
    while (!cancelRequested && jobId === currentJobId) {
      const { done, value } = await activeReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          const normalized = normalizePost(parsed);
          batch.push(normalized);
          postCount += 1;

          const platform = normalized.platform || 'unknown';
          platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);

          const authorId = normalized.data?.author?.id;
          if (authorId) userSet.add(authorId);

          const hashtags = normalized.data?.challenges || [];
          hashtags.forEach(tag => {
            if (tag?.title) {
              hashtagSet.add(tag.title.toLowerCase());
            }
          });

          const stats = normalized.data?.stats || {};
          engagementSum += (stats.diggCount || 0) + (stats.commentCount || 0);

          const ts = normalized.data?.createTime;
          if (Number.isFinite(ts)) {
            minCreateTime = Math.min(minCreateTime, ts);
            maxCreateTime = Math.max(maxCreateTime, ts);
          }

          if (batch.length >= batchSize) {
            flushBatch();
          }
        } catch (err) {
          console.warn('Failed to parse line', err);
        }
      }
    }

    if (!cancelRequested && jobId === currentJobId && buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const normalized = normalizePost(parsed);
        batch.push(normalized);
        postCount += 1;

        const platform = normalized.platform || 'unknown';
        platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);

        const authorId = normalized.data?.author?.id;
        if (authorId) userSet.add(authorId);

        const hashtags = normalized.data?.challenges || [];
        hashtags.forEach(tag => {
          if (tag?.title) {
            hashtagSet.add(tag.title.toLowerCase());
          }
        });

        const stats = normalized.data?.stats || {};
        engagementSum += (stats.diggCount || 0) + (stats.commentCount || 0);

        const ts = normalized.data?.createTime;
        if (Number.isFinite(ts)) {
          minCreateTime = Math.min(minCreateTime, ts);
          maxCreateTime = Math.max(maxCreateTime, ts);
        }
      } catch (err) {
        console.warn('Failed to parse final buffer', err);
      }
    }

    if (!cancelRequested && jobId === currentJobId) {
      flushBatch();

      self.postMessage({
        type: 'done',
        jobId,
        stats: summarizeStats({ postCount, userSet, hashtagSet, engagementSum }),
        platformCounts: Object.fromEntries(platformCounts),
        totalPosts: postCount,
        minCreateTime: Number.isFinite(minCreateTime) ? minCreateTime : null,
        maxCreateTime: Number.isFinite(maxCreateTime) ? maxCreateTime : null,
      });
    }
  } finally {
    if (activeReader) {
      try {
        await activeReader.cancel();
      } catch (err) {
        // ignore
      }
      activeReader = null;
    }
  }
}
