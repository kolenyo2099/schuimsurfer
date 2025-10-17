import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

let extractor = null;

export async function initEmbeddingModel() {
  if (!extractor) {
    console.log('Loading embedding model (Xenova/all-MiniLM-L6-v2, ~23MB)...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✓ Embedding model ready (384-dimensional vectors)');
  }
  return extractor;
}

export async function getEmbedding(text) {
  const model = await initEmbeddingModel();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(vecA, vecB) {
  return vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
}
