// Performance Utilities: Caching, Progressive Loading, Virtual Scrolling

// ==========================
// Computation Cache
// ==========================

export class ComputationCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Generate cache key from data and parameters
   */
  getKey(data, params = {}) {
    const dataHash = this.hashData(data);
    const paramHash = JSON.stringify(params);
    return `${dataHash}:${paramHash}`;
  }

  /**
   * Simple hash based on data characteristics
   */
  hashData(data) {
    if (Array.isArray(data)) {
      return `arr:${data.length}:${data[0]?.data?.author?.id || ''}:${data[data.length - 1]?.data?.author?.id || ''}`;
    }
    if (data && typeof data === 'object' && data.nodes && data.links) {
      return `graph:${data.nodes.length}:${data.links.length}`;
    }
    return JSON.stringify(data).substring(0, 100);
  }

  /**
   * Get cached value or compute and cache it
   */
  get(data, params, computeFn) {
    const key = this.getKey(data, params);

    if (this.cache.has(key)) {
      console.log(`✓ Cache hit: ${key.substring(0, 50)}...`);
      return this.cache.get(key);
    }

    console.log(`⚠ Cache miss, computing: ${key.substring(0, 50)}...`);
    const result = computeFn();
    this.set(key, result);
    return result;
  }

  /**
   * Set cache entry with LRU eviction
   */
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      console.log(`Cache evicted oldest entry: ${firstKey.substring(0, 50)}...`);
    }
    this.cache.set(key, value);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    console.log('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()).map(k => k.substring(0, 50))
    };
  }
}

// Global cache instances
export const networkMetricsCache = new ComputationCache(50);
export const communityDetectionCache = new ComputationCache(20);
export const embeddingsCache = new ComputationCache(10); // Cache embeddings

// ==========================
// Progressive File Loader
// ==========================

export class ProgressiveFileLoader {
  constructor(onProgress, onChunkProcessed) {
    this.onProgress = onProgress;
    this.onChunkProcessed = onChunkProcessed;
    this.chunkSize = 1000; // Process 1000 lines at a time
  }

  /**
   * Load and parse NDJSON file progressively
   */
  async loadNDJSON(file) {
    const totalSize = file.size;
    let loadedSize = 0;
    let buffer = '';
    let allData = [];
    let lineCount = 0;

    try {
      const stream = file.stream();
      const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

      let chunk = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        loadedSize += value.length;
        buffer += value;

        // Report loading progress
        const loadProgress = (loadedSize / totalSize) * 50; // 0-50% for loading
        this.onProgress(loadProgress, `Loading file... ${Math.round(loadProgress)}%`);

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);
            chunk.push(parsed);
            lineCount++;

            // Process chunk when it reaches chunkSize
            if (chunk.length >= this.chunkSize) {
              if (this.onChunkProcessed) {
                await this.onChunkProcessed(chunk, lineCount);
              }
              allData.push(...chunk);
              chunk = [];

              // Report processing progress
              const processProgress = 50 + (allData.length / lineCount) * 25; // 50-75% for processing
              this.onProgress(processProgress, `Processed ${allData.length} posts...`);
            }
          } catch (parseError) {
            console.warn(`Failed to parse line ${lineCount}: ${parseError.message}`);
          }
        }
      }

      // Process remaining lines in buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          chunk.push(parsed);
          lineCount++;
        } catch (parseError) {
          console.warn(`Failed to parse final line: ${parseError.message}`);
        }
      }

      // Process final chunk
      if (chunk.length > 0) {
        if (this.onChunkProcessed) {
          await this.onChunkProcessed(chunk, lineCount);
        }
        allData.push(...chunk);
      }

      this.onProgress(75, `Finalizing ${allData.length} posts...`);

      return allData;

    } catch (error) {
      console.error('Error in progressive file loading:', error);
      throw error;
    }
  }
}

// ==========================
// Virtual Scrolling List
// ==========================

export class VirtualList {
  constructor(container, items, renderItem, itemHeight = 60) {
    this.container = container;
    this.items = items;
    this.renderItem = renderItem;
    this.itemHeight = itemHeight;

    // Calculate visible items based on container height
    this.visibleCount = Math.ceil(container.offsetHeight / this.itemHeight) + 2; // +2 buffer

    this.scrollTop = 0;
    this.scrollHandler = null;

    this.init();
  }

  init() {
    // Set up container
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';

    // Create viewport element
    this.viewport = document.createElement('div');
    this.viewport.style.position = 'relative';
    this.viewport.style.height = `${this.items.length * this.itemHeight}px`;
    this.container.innerHTML = '';
    this.container.appendChild(this.viewport);

    // Bind scroll handler
    this.scrollHandler = this.onScroll.bind(this);
    this.container.addEventListener('scroll', this.scrollHandler);

    // Initial render
    this.render();
  }

  onScroll() {
    this.scrollTop = this.container.scrollTop;
    this.render();
  }

  render() {
    const startIndex = Math.floor(this.scrollTop / this.itemHeight);
    const endIndex = Math.min(startIndex + this.visibleCount, this.items.length);

    // Clear viewport
    this.viewport.innerHTML = '';

    // Create document fragment for efficient DOM updates
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const itemElement = this.renderItem(this.items[i], i);
      itemElement.style.position = 'absolute';
      itemElement.style.top = `${i * this.itemHeight}px`;
      itemElement.style.left = '0';
      itemElement.style.right = '0';
      itemElement.style.height = `${this.itemHeight}px`;
      fragment.appendChild(itemElement);
    }

    this.viewport.appendChild(fragment);
  }

  /**
   * Update items and re-render
   */
  updateItems(newItems) {
    this.items = newItems;
    this.viewport.style.height = `${this.items.length * this.itemHeight}px`;
    this.render();
  }

  /**
   * Destroy virtual list and clean up
   */
  destroy() {
    if (this.scrollHandler) {
      this.container.removeEventListener('scroll', this.scrollHandler);
    }
    this.container.innerHTML = '';
  }
}

// ==========================
// Memory-Efficient Data Structures
// ==========================

/**
 * Create index-based view of filtered data instead of copying
 */
export class DataView {
  constructor(rawData) {
    this.rawData = rawData;
    this.indices = Array.from({ length: rawData.length }, (_, i) => i);
  }

  /**
   * Filter data by creating new index array
   */
  filter(predicate) {
    this.indices = this.indices.filter(i => predicate(this.rawData[i], i));
    return this;
  }

  /**
   * Get item at index
   */
  get(index) {
    return this.rawData[this.indices[index]];
  }

  /**
   * Get all items as array
   */
  toArray() {
    return this.indices.map(i => this.rawData[i]);
  }

  /**
   * Get length
   */
  get length() {
    return this.indices.length;
  }

  /**
   * Iterate over items
   */
  forEach(callback) {
    this.indices.forEach((dataIndex, arrayIndex) => {
      callback(this.rawData[dataIndex], arrayIndex, this);
    });
  }

  /**
   * Map over items
   */
  map(callback) {
    return this.indices.map((dataIndex, arrayIndex) => {
      return callback(this.rawData[dataIndex], arrayIndex, this);
    });
  }

  /**
   * Reset to full dataset
   */
  reset() {
    this.indices = Array.from({ length: this.rawData.length }, (_, i) => i);
    return this;
  }
}

// ==========================
// Progressive Network Visualization
// ==========================

/**
 * Select top nodes for visualization while keeping all for analysis
 */
export function selectTopNodesForVisualization(graphData, maxNodes = 1000) {
  if (graphData.nodes.length <= maxNodes) {
    return graphData; // No need to limit
  }

  // Calculate node degrees
  const nodeDegrees = new Map();
  graphData.nodes.forEach(node => nodeDegrees.set(node.id, 0));

  graphData.links.forEach(link => {
    nodeDegrees.set(link.source, (nodeDegrees.get(link.source) || 0) + 1);
    nodeDegrees.set(link.target, (nodeDegrees.get(link.target) || 0) + 1);
  });

  // Sort nodes by degree (descending)
  const sortedNodes = [...graphData.nodes].sort((a, b) => {
    return (nodeDegrees.get(b.id) || 0) - (nodeDegrees.get(a.id) || 0);
  });

  // Select top N nodes
  const topNodes = sortedNodes.slice(0, maxNodes);
  const topNodeIds = new Set(topNodes.map(n => n.id));

  // Filter links to only include those between top nodes
  const filteredLinks = graphData.links.filter(link =>
    topNodeIds.has(link.source) && topNodeIds.has(link.target)
  );

  console.log(`Progressive visualization: Showing ${topNodes.length} of ${graphData.nodes.length} nodes`);
  console.log(`Filtered ${graphData.links.length - filteredLinks.length} edges`);

  return {
    nodes: topNodes,
    links: filteredLinks,
    totalNodes: graphData.nodes.length,
    totalLinks: graphData.links.length,
    isFiltered: true
  };
}

/**
 * Batch process large arrays with progress updates
 */
export async function batchProcess(items, processFn, batchSize = 100, onProgress = null) {
  const results = [];
  const total = items.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, total));
    const batchResults = await processFn(batch, i);
    results.push(...batchResults);

    if (onProgress) {
      onProgress(i + batch.length, total);
    }

    // Yield to browser to keep UI responsive
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return results;
}

// ==========================
// Performance Monitor
// ==========================

export class PerformanceMonitor {
  constructor() {
    this.timings = new Map();
  }

  start(label) {
    this.timings.set(label, performance.now());
  }

  end(label) {
    const startTime = this.timings.get(label);
    if (startTime === undefined) {
      console.warn(`No start time found for label: ${label}`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.timings.delete(label);

    console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  logMemory() {
    if (performance.memory) {
      const used = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
      const total = (performance.memory.totalJSHeapSize / 1048576).toFixed(2);
      console.log(`💾 Memory: ${used}MB / ${total}MB`);
    }
  }
}

export const perfMonitor = new PerformanceMonitor();
