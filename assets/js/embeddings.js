import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

let extractor = null;
const embeddingCache = new Map();
const pendingEmbeddings = new Map();

function extractVectors(output, expectedBatch) {
  if (!output) return [];

  if (Array.isArray(output)) {
    if (output.length > 0 && typeof output[0] === 'number') {
      return [Array.from(output)];
    }
    return output.map(item => {
      const data = item?.data ?? item;
      return Array.from(data);
    });
  }

  const data = output.data ?? output;
  const dims = output.dims ?? null;
  if (!data) {
    throw new Error('Embedding output missing tensor data');
  }

  const flat = Array.from(data);

  if (!dims || dims.length === 0) {
    if (expectedBatch && expectedBatch > 1) {
      if (flat.length % expectedBatch !== 0) {
        throw new Error(`Embedding output length ${flat.length} not divisible by batch size ${expectedBatch}`);
      }
      const dim = flat.length / expectedBatch;
      const vectors = [];
      for (let i = 0; i < expectedBatch; i++) {
        vectors.push(flat.slice(i * dim, (i + 1) * dim));
      }
      return vectors;
    }
    return [flat];
  }

  if (dims.length === 1) {
    const dim = dims[0];
    if (expectedBatch && expectedBatch > 1) {
      if (flat.length !== dim * expectedBatch) {
        throw new Error(`Embedding tensor size mismatch for batch ${expectedBatch}`);
      }
      const vectors = [];
      for (let i = 0; i < expectedBatch; i++) {
        vectors.push(flat.slice(i * dim, (i + 1) * dim));
      }
      return vectors;
    }
    return [flat];
  }

  if (dims.length === 2) {
    const [batch, dim] = dims;
    if (expectedBatch && batch !== expectedBatch) {
      throw new Error(`Embedding batch mismatch: expected ${expectedBatch}, received ${batch}`);
    }
    const vectors = [];
    for (let i = 0; i < batch; i++) {
      vectors.push(flat.slice(i * dim, (i + 1) * dim));
    }
    return vectors;
  }

  throw new Error(`Unsupported embedding tensor dimensions: ${dims}`);
}

export async function initEmbeddingModel() {
  if (!extractor) {
    console.log('Loading embedding model (Xenova/all-MiniLM-L6-v2, ~23MB)...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✓ Embedding model ready (384-dimensional vectors)');
  }
  return extractor;
}

export async function getEmbeddingsBatch(texts, { batchSize = 8 } = {}) {
  if (!Array.isArray(texts)) {
    throw new Error('getEmbeddingsBatch expects an array of texts');
  }

  const results = new Array(texts.length);
  const waits = [];
  const dedupe = new Map();

  texts.forEach((text = '', idx) => {
    const key = text;
    if (embeddingCache.has(key)) {
      results[idx] = embeddingCache.get(key);
      return;
    }

    if (pendingEmbeddings.has(key)) {
      waits.push(
        pendingEmbeddings.get(key).then(vec => {
          results[idx] = vec;
        })
      );
      return;
    }

    if (!dedupe.has(key)) {
      dedupe.set(key, []);
    }
    dedupe.get(key).push(idx);
  });

  if (dedupe.size > 0) {
    const model = await initEmbeddingModel();
    const entries = Array.from(dedupe.entries());

    for (let start = 0; start < entries.length; start += batchSize) {
      const batchEntries = entries.slice(start, start + batchSize);
      const textsForBatch = batchEntries.map(([text]) => text);

      const batchPromise = (async () => {
        const output = await model(textsForBatch, { pooling: 'mean', normalize: true });
        return extractVectors(output, textsForBatch.length);
      })();

      batchEntries.forEach(([text, indices], batchIndex) => {
        const textPromise = batchPromise.then(vectors => {
          if (!Array.isArray(vectors) || vectors.length <= batchIndex) {
            throw new Error('Embedding batch result misalignment');
          }
          return vectors[batchIndex];
        });

        pendingEmbeddings.set(text, textPromise);
        waits.push(
          textPromise
            .then(vec => {
              embeddingCache.set(text, vec);
              indices.forEach(i => {
                results[i] = vec;
              });
            })
            .finally(() => {
              pendingEmbeddings.delete(text);
            })
        );
      });
    }
  }

  if (waits.length > 0) {
    await Promise.all(waits);
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
