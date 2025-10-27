import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

let extractor = null;
const embeddingCache = new Map();

export async function initEmbeddingModel() {
  if (!extractor) {
    console.log('Loading embedding model (Xenova/all-MiniLM-L6-v2, ~23MB)...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✓ Embedding model ready (384-dimensional vectors)');
  }
  return extractor;
}

function sanitizeKey(text) {
  return (text || '').trim();
}

function normalizeTensorOutput(output, expectedBatch) {
  if (!output) return [];

  const ensureNumbers = (row) => Array.from(row, Number);

  // Pipeline sometimes returns arrays of tensors/arrays for batched calls.
  if (Array.isArray(output)) {
    if (output.length === expectedBatch) {
      if (output.every(item => Array.isArray(item))) {
        return output.map(ensureNumbers);
      }
      if (output.every(item => item?.data)) {
        return output.map(item => ensureNumbers(item.data));
      }
    }
    if (expectedBatch === 1 && output.length === 1) {
      const single = output[0];
      if (Array.isArray(single)) return [ensureNumbers(single)];
      if (single?.data) return [ensureNumbers(single.data)];
    }
  }

  if (typeof output?.tolist === 'function') {
    const list = output.tolist();
    if (Array.isArray(list)) {
      if (list.length === expectedBatch && Array.isArray(list[0])) {
        return list.map(ensureNumbers);
      }
      if (expectedBatch === 1) {
        return [ensureNumbers(list)];
      }
    }
  }

  if (output?.data) {
    const flat = ensureNumbers(output.data);
    const dims = Array.isArray(output.dims) ? output.dims : null;

    if (dims && dims.length >= 2) {
      const batch = dims[0];
      const stride = dims.slice(1).reduce((acc, dim) => acc * dim, 1);
      if (batch !== expectedBatch) {
        throw new Error(`Embedding batch size mismatch: expected ${expectedBatch}, received ${batch}`);
      }
      const rows = [];
      for (let i = 0; i < batch; i++) {
        rows.push(flat.slice(i * stride, (i + 1) * stride));
      }
      return rows;
    }

    if (expectedBatch === 1) {
      return [flat];
    }

    const stride = flat.length / expectedBatch;
    if (!Number.isInteger(stride)) {
      throw new Error(`Embedding batch size mismatch: expected ${expectedBatch}, received fractional stride ${stride}`);
    }
    const rows = [];
    for (let i = 0; i < expectedBatch; i++) {
      rows.push(flat.slice(i * stride, (i + 1) * stride));
    }
    return rows;
  }

  if (expectedBatch === 1 && typeof output === 'object' && output !== null) {
    return [ensureNumbers(output)];
  }

  throw new Error('Embedding batch size mismatch: unrecognized tensor shape');
}

export async function getEmbeddingsBatch(texts, { batchSize = 8, onProgress } = {}) {
  if (!Array.isArray(texts)) {
    texts = [texts];
  }

  const trimmed = texts.map(sanitizeKey);
  const results = new Array(trimmed.length);
  const pending = [];
  const pendingIndices = [];
  const total = trimmed.length;
  let completed = 0;

  trimmed.forEach((text, index) => {
    if (embeddingCache.has(text)) {
      results[index] = embeddingCache.get(text);
      completed++;
    } else {
      pending.push(texts[index]);
      pendingIndices.push(index);
    }
  });

  if (total === 0) {
    if (typeof onProgress === 'function') {
      onProgress(0, 0);
    }
    return results;
  }

  if (pending.length === 0) {
    if (typeof onProgress === 'function') {
      onProgress(total, total);
    }
    return results;
  }

  if (typeof onProgress === 'function' && completed > 0) {
    onProgress(completed, total);
  }

  const model = await initEmbeddingModel();

  for (let start = 0; start < pending.length; start += batchSize) {
    const batchTexts = pending.slice(start, start + batchSize);
    const batchIndices = pendingIndices.slice(start, start + batchSize);
    const tensor = await model(batchTexts, { pooling: 'mean', normalize: true });
    const embeddings = normalizeTensorOutput(tensor, batchTexts.length);

    embeddings.forEach((embedding, offset) => {
      const idx = batchIndices[offset];
      const key = trimmed[idx];
      embeddingCache.set(key, embedding);
      results[idx] = embedding;
      completed++;
      if (typeof onProgress === 'function') {
        onProgress(completed, total);
      }
    });
  }

  if (typeof onProgress === 'function' && completed < total) {
    onProgress(total, total);
  }

  return results;
}

export async function getEmbedding(text) {
  const [embedding] = await getEmbeddingsBatch([text]);
  return embedding;
}

export function cosineSimilarity(vecA, vecB) {
  return vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
}
