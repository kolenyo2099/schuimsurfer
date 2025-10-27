import { filterData, calculateDatasetStatistics } from '../analytics.js';
import { buildNetwork, calculateNetworkMetrics, detectCommunities } from '../network.js';
import { runCibAnalysis } from '../cib.js';

let dataset = [];
let lastFiltered = [];
let lastFilterSignature = null;
let lastStats = null;

function signature(filters = {}) {
  return JSON.stringify({
    minEngagement: Number(filters.minEngagement) || 0,
    startDate: Number.isFinite(filters.startDate) ? filters.startDate : null,
    endDate: Number.isFinite(filters.endDate) ? filters.endDate : null,
  });
}

self.addEventListener('message', async (event) => {
  const { type } = event.data || {};
  try {
    switch (type) {
      case 'reset':
        dataset = [];
        lastFiltered = [];
        lastFilterSignature = null;
        lastStats = null;
        break;
      case 'appendPosts': {
        const posts = event.data.posts || [];
        if (Array.isArray(posts) && posts.length > 0) {
          dataset.push(...posts);
        }
        break;
      }
      case 'filter-and-build': {
        const { filters = {}, networkType, requestId } = event.data;
        const sig = signature(filters);
        const filtered = filterData(dataset, filters);
        lastFiltered = filtered;
        lastFilterSignature = sig;
        lastStats = calculateDatasetStatistics(filtered);
        const network = buildNetwork(filtered, networkType);
        const metrics = calculateNetworkMetrics(network);
        self.postMessage({
          type: 'network',
          requestId,
          filtered,
          network,
          metrics,
          stats: lastStats,
          filterSignature: sig,
        });
        break;
      }
      case 'run-cib': {
        const { filters = {}, params, timeWindow, requestId } = event.data;
        let filtered = lastFiltered;
        const sig = signature(filters);
        if (!filtered || !lastFilterSignature || sig !== lastFilterSignature) {
          filtered = filterData(dataset, filters);
          lastFiltered = filtered;
          lastFilterSignature = sig;
          lastStats = calculateDatasetStatistics(filtered);
        }
        const results = await runCibAnalysis(filtered, params, timeWindow);
        self.postMessage({
          type: 'cib-results',
          requestId,
          results,
        });
        break;
      }
      case 'detect-communities': {
        const { graph, requestId } = event.data;
        const communities = detectCommunities(graph);
        self.postMessage({
          type: 'communities',
          requestId,
          result: communities
            ? {
                count: communities.count,
                assignments: Array.from(communities.communities.entries()),
              }
            : null,
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      context: type,
      message: err?.message || String(err),
    });
  }
});
