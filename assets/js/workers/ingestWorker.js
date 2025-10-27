import { normalizePost } from '../normalization.js';
import { createRollingStatsState, updateRollingStats, snapshotRollingStats } from '../analytics.js';

const DEFAULT_BATCH_SIZE = 500;

let abortController = null;

self.onmessage = async (event) => {
  const { data } = event;
  if (!data) return;

  if (data.type === 'ingest') {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    try {
      await processFile(data.file, data.batchSize || DEFAULT_BATCH_SIZE, abortController.signal);
    } catch (error) {
      if (error?.name === 'AbortError') {
        postMessage({ type: 'aborted' });
      } else {
        postMessage({ type: 'error', message: error?.message || 'Unknown ingest error' });
      }
    } finally {
      abortController = null;
    }
  } else if (data.type === 'cancel' && abortController) {
    abortController.abort();
  }
};

async function processFile(file, batchSize, signal) {
  if (!file) {
    throw new Error('No file provided');
  }

  const totalRecords = await estimateTotalRecords(file, signal);

  const reader = file.stream().getReader({ signal });
  const decoder = new TextDecoder();
  let buffer = '';
  let batch = [];
  let count = 0;
  const statsState = createRollingStatsState();
  const platformCounts = Object.create(null);
  let minTimestamp = Number.POSITIVE_INFINITY;
  let maxTimestamp = Number.NEGATIVE_INFINITY;

  postMessage({ type: 'progress', message: 'Streaming upload…', current: 0, total: totalRecords });

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        if (signal.aborted) {
          throw new DOMException('Ingest aborted', 'AbortError');
        }

        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          throw new Error(`Failed to parse NDJSON on line ${count + 1}: ${err.message}`);
        }

        const normalized = normalizePost(parsed);
        updateRollingStats(statsState, normalized);
        batch.push(normalized);
        count++;

        const platform = normalized.platform || 'unknown';
        platformCounts[platform] = (platformCounts[platform] || 0) + 1;

        const timestamp = normalized?.data?.createTime;
        if (typeof timestamp === 'number') {
          if (timestamp < minTimestamp) minTimestamp = timestamp;
          if (timestamp > maxTimestamp) maxTimestamp = timestamp;
        }

        if (batch.length >= batchSize) {
          flushBatch(batch, statsState, platformCounts, minTimestamp, maxTimestamp, count, totalRecords);
          batch = [];
        }
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(buffer.trim());
    } catch (err) {
      throw new Error(`Failed to parse NDJSON on line ${count + 1}: ${err.message}`);
    }
    const normalized = normalizePost(parsed);
    updateRollingStats(statsState, normalized);
    batch.push(normalized);
    count++;

    const platform = normalized.platform || 'unknown';
    platformCounts[platform] = (platformCounts[platform] || 0) + 1;

    const timestamp = normalized?.data?.createTime;
    if (typeof timestamp === 'number') {
      if (timestamp < minTimestamp) minTimestamp = timestamp;
      if (timestamp > maxTimestamp) maxTimestamp = timestamp;
    }
  }

  if (batch.length > 0) {
    flushBatch(batch, statsState, platformCounts, minTimestamp, maxTimestamp, count, totalRecords);
  }

  reader.releaseLock();

  postMessage({
    type: 'done',
    total: count,
    expected: totalRecords,
    stats: snapshotRollingStats(statsState),
    platformSummary: serializePlatformCounts(platformCounts),
    dateRange: serializeDateRange(minTimestamp, maxTimestamp),
  });
}

function flushBatch(batch, statsState, platformCounts, minTimestamp, maxTimestamp, count, total) {
  const payload = {
    type: 'batch',
    records: batch,
    stats: snapshotRollingStats(statsState),
    platformSummary: serializePlatformCounts(platformCounts),
    dateRange: serializeDateRange(minTimestamp, maxTimestamp),
    count,
    total,
  };
  postMessage(payload);
}

async function estimateTotalRecords(file, signal) {
  // Create a fresh reader to count newline-delimited entries without loading the whole file
  const reader = file.stream().getReader({ signal });
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          total++;
        }
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    total++;
  }

  reader.releaseLock();

  return total;
}

function serializePlatformCounts(platformCounts) {
  return Object.entries(platformCounts).map(([platform, total]) => ({ platform, total }));
}

function serializeDateRange(minTimestamp, maxTimestamp) {
  if (!Number.isFinite(minTimestamp) || !Number.isFinite(maxTimestamp)) {
    return null;
  }
  return { min: minTimestamp, max: maxTimestamp };
}
