import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

let extractor = null;
const embeddingCache = new Map();
const DEFAULT_BATCH_SIZE = 8;

export async function initEmbeddingModel() {
  if (!extractor) {
    console.log('Loading embedding model (Xenova/all-MiniLM-L6-v2, ~23MB)...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✓ Embedding model ready (384-dimensional vectors)');
  }
  return extractor;
}

export function clearEmbeddingCache() {
  embeddingCache.clear();
}

export async function getEmbeddings(texts, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  if (!Array.isArray(texts)) {
    throw new Error('getEmbeddings expects an array of texts');
  }

  const model = await initEmbeddingModel();
  const normalizedTexts = texts.map(text => (text || '').trim());
  const results = new Array(normalizedTexts.length);
  const toCompute = [];

  normalizedTexts.forEach((text, index) => {
    if (!text) {
      results[index] = null;
      return;
    }

    if (embeddingCache.has(text)) {
      results[index] = embeddingCache.get(text);
    } else {
      toCompute.push({ index, text });
    }
  });

  for (let i = 0; i < toCompute.length; i += batchSize) {
    const batch = toCompute.slice(i, i + batchSize);
    const batchTexts = batch.map(item => item.text);
    // Xenova pipelines accept batched input as an array of strings.
    const output = await model(batchTexts, { pooling: 'mean', normalize: true });
    const embeddings = Array.isArray(output)
      ? output.map(entry => Array.from(entry.data))
      : (output?.data ? [Array.from(output.data)] : []);

    if (embeddings.length !== batch.length) {
      throw new Error('Embedding batch size mismatch');
    }

    batch.forEach((item, idx) => {
      const vector = embeddings[idx];
      embeddingCache.set(item.text, vector);
      results[item.index] = vector;
    });
  }

  return results;
}

export async function getEmbedding(text) {
  const [embedding] = await getEmbeddings([text]);
  return embedding;
}

export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  return vecA.reduce((sum, a, i) => sum + a * (vecB[i] ?? 0), 0);
}
