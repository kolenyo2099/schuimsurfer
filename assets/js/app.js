import { initEmbeddingModel, getEmbedding, cosineSimilarity } from './embeddings.js';
import { normalizeRawData } from './normalization.js';
import {
  calculateStats,
  filterData,
  calculateDatasetStatistics,
  calculateTFIDF,
  getNGrams,
  ngramOverlap,
  levenshteinDistance,
  analyzePostingRhythm,
  analyzeNightPosting,
  detectAccountCreationClusters,
  detectTemporalBursts,
} from './analytics.js';

// =========================
// Global state
// =========================
let rawData = [];
let filteredData = [];
let graphData = null;
let nodes = [];
let communities = null;
let cibDetection = null;
let animationFrame = null;
let networkMetrics = null;

// Expose nodes globally for WebGL renderer access
window.nodes = nodes;

// Hover & modal helpers / indexes
let idToNode = new Map();     // node.id -> node (with x,y)
let adjacency = new Map();    // node.id -> Set(neighborIds)
let hoveredNode = null;

// =========================
// DOM elements
// =========================
const fileInput = document.getElementById('file-input');
const networkTypeSelect = document.getElementById('network-type');
const nodeSizeBySelect = document.getElementById('node-size-by');
const engagementFilter = document.getElementById('engagement-filter');
const engagementValue = document.getElementById('engagement-value');
const cibThreshold = document.getElementById('cib-threshold');
const thresholdValue = document.getElementById('threshold-value');
const timeWindowInput = document.getElementById('time-window');
const timeWindowValue = document.getElementById('time-window-value');
const dateStart = document.getElementById('date-start');
const dateEnd = document.getElementById('date-end');
const searchInput = document.getElementById('search-input');
const exportBtn = document.getElementById('export-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportReportBtn = document.getElementById('export-report-btn');
const detectBtn = document.getElementById('detect-btn');
const cibBtn = document.getElementById('cib-btn');
const cibSettingsBtn = document.getElementById('cib-settings-btn');
const cibSettingsPanel = document.getElementById('cib-settings-panel');
const closeCibSettings = document.getElementById('close-cib-settings');
const resetCibParamsBtn = document.getElementById('reset-cib-params');
const canvas = document.getElementById('network-canvas');
let ctx = null; // Don't create context yet - let renderer decide
let gl = null;
let gpuRenderer = null;
const emptyState = document.getElementById('empty-state');
const statsDiv = document.getElementById('stats');
const nodeInfo = document.getElementById('node-info');
const nodeDetails = document.getElementById('node-details');
const closeInfo = document.getElementById('close-info');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const metricsPanel = document.getElementById('metrics-panel');
const metricsList = document.getElementById('metrics-list');
const cibPanel = document.getElementById('cib-panel');
const cibResults = document.getElementById('cib-results');
const tooltipEl = document.getElementById('node-tooltip');
const modalEl   = document.getElementById('node-modal');
const modalClose= document.getElementById('modal-close');
const modalTitle= document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalContentWrapper = document.getElementById('modal-content-wrapper');
const platformIndicator = document.getElementById('platform-indicator');
const renderingIndicator = document.getElementById('rendering-indicator');

const statElements = {
  posts: document.getElementById('stat-posts'),
  users: document.getElementById('stat-users'),
  hashtags: document.getElementById('stat-hashtags'),
  engagement: document.getElementById('stat-engagement'),
  nodes: document.getElementById('stat-nodes'),
  edges: document.getElementById('stat-edges'),
  density: document.getElementById('stat-density'),
  communities: document.getElementById('stat-communities'),
  suspicious: document.getElementById('stat-suspicious'),
};

function updateStatCards(statsData) {
  if (!statsData) return;
  if (statElements.posts) statElements.posts.textContent = statsData.posts ?? 0;
  if (statElements.users) statElements.users.textContent = statsData.users ?? 0;
  if (statElements.hashtags) statElements.hashtags.textContent = statsData.hashtags ?? 0;
  if (statElements.engagement) statElements.engagement.textContent = statsData.engagement ?? 0;
}

// =========================
// UI constants
// =========================
const communityColors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16'];
const thresholdLabels = {
  1:'Very Low (1)',2:'Low (2)',3:'Low-Med (3)',4:'Medium-Low (4)',5:'Medium (5)',
  6:'Medium-High (6)',7:'High-Med (7)',8:'High (8)',9:'Very High (9)',10:'Maximum (10)'
};

cibThreshold.addEventListener('input', (e)=>{ 
  const val = e.target.value;
  thresholdValue.textContent = thresholdLabels[val]; 
  // Apply sensitivity preset to advanced parameters
  applySensitivityPreset(parseInt(val, 10));
});

timeWindowInput.addEventListener('input', (e) => {
  const seconds = parseInt(e.target.value);
  if (seconds < 60) {
    timeWindowValue.textContent = `${seconds} second${seconds !== 1 ? 's' : ''}`;
  } else {
    const minutes = Math.floor(seconds / 60);
    const remainingSecs = seconds % 60;
    if (remainingSecs === 0) {
      timeWindowValue.textContent = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      timeWindowValue.textContent = `${minutes}m ${remainingSecs}s`;
    }
  }
});

// =========================
// File upload
// =========================
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  loading.classList.add('active');
  loadingText.textContent = 'Loading data...';

  try {
    const text = await file.text();
    const lines = text.trim().split('\n');
    const parsed = lines.map(line => JSON.parse(line));
    
    // Normalize data to handle both TikTok and Instagram
    rawData = normalizeRawData(parsed);

    // Detect platforms
    const platformCounts = {};
    rawData.forEach(p => {
      const platform = p.platform || 'unknown';
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    });
    
    const platformParts = [];
    if (platformCounts.tiktok) platformParts.push(`🎵 TikTok (${platformCounts.tiktok})`);
    if (platformCounts.instagram) platformParts.push(`📷 Instagram (${platformCounts.instagram})`);
    if (platformCounts.twitter) platformParts.push(`🐦 Twitter/X (${platformCounts.twitter})`);
    if (platformCounts.unknown) platformParts.push(`❓ Unknown (${platformCounts.unknown})`);
    
    const platformText = platformParts.join(' · ') || 'No data';
    platformIndicator.textContent = `· ${platformText}`;
    console.log(`Loaded ${rawData.length} posts from: ${platformText}`);

    // set date bounds from data (both platforms use createTime after normalization)
    const dates = rawData.map(p => p.data?.createTime).filter(Boolean);
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates) * 1000);
      const maxDate = new Date(Math.max(...dates) * 1000);
      dateStart.value = minDate.toISOString().split('T')[0];
      dateEnd.value = maxDate.toISOString().split('T')[0];
    }

    const statSummary = calculateStats(rawData);
    updateStatCards(statSummary);
    updateNetwork();
    emptyState.style.display = 'none';
    statsDiv.style.display = 'grid';
    exportBtn.disabled = false;
    detectBtn.disabled = false;
    cibBtn.disabled = false;
    cibSettingsBtn.disabled = false;
    // CIB export buttons enabled after CIB detection runs
  } catch (err) {
    alert('Error parsing file: ' + err.message);
  } finally {
    loading.classList.remove('active');
  }
});

// =========================
// CIB Advanced Parameters
// =========================

// Default parameter values (Medium sensitivity = 5)
const defaultCibParams = {
  semanticEnabled: true,
  semanticThreshold: 0.85,
  ngramThreshold: 0.3,
  usernameThreshold: 0.8,
  tfidfThreshold: 0.5,
  zscoreThreshold: 2,
  burstPosts: 5,
  rhythmCV: 0.1,
  nightGap: 7200,
  clusterSize: 5,
  crossMultiplier: 0.3,
  // Group size thresholds
  minSyncPosts: 2,
  minHashtagGroupSize: 3,
  minUsernameGroupSize: 3,
  minHighVolumePosts: 5
};

// Get parameter preset based on sensitivity level (1-10)
// Lower threshold value = higher sensitivity (more detections)
// Higher threshold value = lower sensitivity (fewer, higher-confidence detections)
function getSensitivityPreset(thresholdValue) {
  const presets = {
    1: { // Very Low - Maximum sensitivity
      semanticEnabled: true,
      semanticThreshold: 0.70,
      ngramThreshold: 0.15,
      usernameThreshold: 0.60,
      tfidfThreshold: 0.25,
      zscoreThreshold: 1.0,
      burstPosts: 3,
      rhythmCV: 0.20,
      nightGap: 14400,
      clusterSize: 3,
      crossMultiplier: 0.20,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    2: { // Low
      semanticEnabled: true,
      semanticThreshold: 0.75,
      ngramThreshold: 0.20,
      usernameThreshold: 0.70,
      tfidfThreshold: 0.35,
      zscoreThreshold: 1.5,
      burstPosts: 4,
      rhythmCV: 0.15,
      nightGap: 10800,
      clusterSize: 4,
      crossMultiplier: 0.25,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    3: { // Low-Med
      semanticEnabled: true,
      semanticThreshold: 0.78,
      ngramThreshold: 0.22,
      usernameThreshold: 0.75,
      tfidfThreshold: 0.40,
      zscoreThreshold: 1.7,
      burstPosts: 4,
      rhythmCV: 0.12,
      nightGap: 9000,
      clusterSize: 4,
      crossMultiplier: 0.25,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    4: { // Medium-Low
      semanticEnabled: true,
      semanticThreshold: 0.82,
      ngramThreshold: 0.25,
      usernameThreshold: 0.77,
      tfidfThreshold: 0.45,
      zscoreThreshold: 1.8,
      burstPosts: 4,
      rhythmCV: 0.11,
      nightGap: 7800,
      clusterSize: 4,
      crossMultiplier: 0.27,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    5: { // Medium (default)
      semanticEnabled: true,
      semanticThreshold: 0.85,
      ngramThreshold: 0.30,
      usernameThreshold: 0.80,
      tfidfThreshold: 0.50,
      zscoreThreshold: 2.0,
      burstPosts: 5,
      rhythmCV: 0.10,
      nightGap: 7200,
      clusterSize: 5,
      crossMultiplier: 0.30,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    6: { // Medium-High
      semanticEnabled: true,
      semanticThreshold: 0.87,
      ngramThreshold: 0.35,
      usernameThreshold: 0.83,
      tfidfThreshold: 0.55,
      zscoreThreshold: 2.2,
      burstPosts: 5,
      rhythmCV: 0.09,
      nightGap: 6600,
      clusterSize: 5,
      crossMultiplier: 0.32,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 5
    },
    7: { // High-Med
      semanticEnabled: true,
      semanticThreshold: 0.89,
      ngramThreshold: 0.40,
      usernameThreshold: 0.85,
      tfidfThreshold: 0.60,
      zscoreThreshold: 2.5,
      burstPosts: 6,
      rhythmCV: 0.08,
      nightGap: 6000,
      clusterSize: 6,
      crossMultiplier: 0.35,
      minSyncPosts: 2,
      minHashtagGroupSize: 3,
      minUsernameGroupSize: 3,
      minHighVolumePosts: 6
    },
    8: { // High
      semanticEnabled: true,
      semanticThreshold: 0.91,
      ngramThreshold: 0.45,
      usernameThreshold: 0.88,
      tfidfThreshold: 0.70,
      zscoreThreshold: 2.8,
      burstPosts: 7,
      rhythmCV: 0.07,
      nightGap: 5400,
      clusterSize: 6,
      crossMultiplier: 0.38,
      minSyncPosts: 3,
      minHashtagGroupSize: 5,
      minUsernameGroupSize: 4,
      minHighVolumePosts: 8
    },
    9: { // Very High
      semanticEnabled: true,
      semanticThreshold: 0.93,
      ngramThreshold: 0.50,
      usernameThreshold: 0.90,
      tfidfThreshold: 0.80,
      zscoreThreshold: 3.2,
      burstPosts: 8,
      rhythmCV: 0.06,
      nightGap: 4800,
      clusterSize: 7,
      crossMultiplier: 0.42,
      minSyncPosts: 5,
      minHashtagGroupSize: 7,
      minUsernameGroupSize: 6,
      minHighVolumePosts: 12
    },
    10: { // Maximum - Strictest settings
      semanticEnabled: true,
      semanticThreshold: 0.95,
      ngramThreshold: 0.60,
      usernameThreshold: 0.93,
      tfidfThreshold: 1.00,
      zscoreThreshold: 3.5,
      burstPosts: 9,
      rhythmCV: 0.05,
      nightGap: 3600,
      clusterSize: 8,
      crossMultiplier: 0.45,
      minSyncPosts: 10,
      minHashtagGroupSize: 15,
      minUsernameGroupSize: 12,
      minHighVolumePosts: 25
    }
  };
  
  return presets[thresholdValue] || presets[5]; // Default to medium if invalid
}

// Apply sensitivity preset to UI inputs
function applySensitivityPreset(thresholdValue) {
  const preset = getSensitivityPreset(thresholdValue);
  
  document.getElementById('param-semantic-enabled').value = preset.semanticEnabled.toString();
  document.getElementById('param-semantic-threshold').value = preset.semanticThreshold;
  document.getElementById('param-ngram-threshold').value = preset.ngramThreshold;
  document.getElementById('param-username-threshold').value = preset.usernameThreshold;
  document.getElementById('param-tfidf-threshold').value = preset.tfidfThreshold;
  document.getElementById('param-zscore-threshold').value = preset.zscoreThreshold;
  document.getElementById('param-burst-posts').value = preset.burstPosts;
  document.getElementById('param-rhythm-cv').value = preset.rhythmCV;
  document.getElementById('param-night-gap').value = preset.nightGap;
  document.getElementById('param-cluster-size').value = preset.clusterSize;
  document.getElementById('param-cross-multiplier').value = preset.crossMultiplier;
  document.getElementById('param-min-sync-posts').value = preset.minSyncPosts;
  document.getElementById('param-min-hashtag-group').value = preset.minHashtagGroupSize;
  document.getElementById('param-min-username-group').value = preset.minUsernameGroupSize;
  document.getElementById('param-min-highvolume-posts').value = preset.minHighVolumePosts;
  
  // Update the sensitivity preset indicator if it exists
  const presetIndicator = document.getElementById('sensitivity-preset-indicator');
  if (presetIndicator) {
    presetIndicator.textContent = `Current preset: ${thresholdLabels[thresholdValue]}`;
  }
}

// Get current parameter values from UI (or defaults if panel not visible)
function getCibParams() {
  return {
    semanticEnabled: document.getElementById('param-semantic-enabled')?.value === 'true',
    semanticThreshold: parseFloat(document.getElementById('param-semantic-threshold')?.value || defaultCibParams.semanticThreshold),
    ngramThreshold: parseFloat(document.getElementById('param-ngram-threshold')?.value || defaultCibParams.ngramThreshold),
    usernameThreshold: parseFloat(document.getElementById('param-username-threshold')?.value || defaultCibParams.usernameThreshold),
    tfidfThreshold: parseFloat(document.getElementById('param-tfidf-threshold')?.value || defaultCibParams.tfidfThreshold),
    zscoreThreshold: parseFloat(document.getElementById('param-zscore-threshold')?.value || defaultCibParams.zscoreThreshold),
    burstPosts: parseInt(document.getElementById('param-burst-posts')?.value || defaultCibParams.burstPosts),
    rhythmCV: parseFloat(document.getElementById('param-rhythm-cv')?.value || defaultCibParams.rhythmCV),
    nightGap: parseInt(document.getElementById('param-night-gap')?.value || defaultCibParams.nightGap),
    clusterSize: parseInt(document.getElementById('param-cluster-size')?.value || defaultCibParams.clusterSize),
    crossMultiplier: parseFloat(document.getElementById('param-cross-multiplier')?.value || defaultCibParams.crossMultiplier),
    minSyncPosts: parseInt(document.getElementById('param-min-sync-posts')?.value || defaultCibParams.minSyncPosts),
    minHashtagGroupSize: parseInt(document.getElementById('param-min-hashtag-group')?.value || defaultCibParams.minHashtagGroupSize),
    minUsernameGroupSize: parseInt(document.getElementById('param-min-username-group')?.value || defaultCibParams.minUsernameGroupSize),
    minHighVolumePosts: parseInt(document.getElementById('param-min-highvolume-posts')?.value || defaultCibParams.minHighVolumePosts)
  };
}

// Reset parameters to defaults (based on current sensitivity level)
function resetCibParams() {
  const currentThreshold = parseInt(cibThreshold.value, 10);
  applySensitivityPreset(currentThreshold);
}

// =========================
// CIB detection (heuristics)
// =========================
async function detectCIB() {
  loading.classList.add('active');
  loadingText.textContent = 'Analyzing coordinated behavior patterns...';

  setTimeout(async () => {
    const results = { suspiciousUsers: new Set(), indicators: {} };
    
    // Get advanced parameters (uses defaults if settings panel not customized)
    const params = getCibParams();
    
    // Initialize embedding model only if semantic similarity is enabled
    if (params.semanticEnabled) {
      await initEmbeddingModel();
    }
    
    // Calculate dataset statistics for adaptive thresholds
      const stats = calculateDatasetStatistics(filteredData);

    // 1) Synchronized posting
    const postsByUser = new Map();
    filteredData.forEach(post => {
      const userId = post.data?.author?.id;
      const timestamp = post.data?.createTime;
      if (!userId || !timestamp) return;
      if (!postsByUser.has(userId)) postsByUser.set(userId, []);
      postsByUser.get(userId).push({ timestamp, post });
    });
    const timeWindow = parseInt(timeWindowInput.value, 10);
    const synchGroups = [];
    const userTs = Array.from(postsByUser.entries());
    for (let i=0;i<userTs.length;i++){
      for (let j=i+1;j<userTs.length;j++){
        const [u1, p1] = userTs[i]; const [u2, p2] = userTs[j];
        let syncCount = 0;
        p1.forEach(a => p2.forEach(b => { if (Math.abs(a.timestamp - b.timestamp) < timeWindow) syncCount++; }));
        if (syncCount >= params.minSyncPosts) {
          results.suspiciousUsers.add(u1); results.suspiciousUsers.add(u2); synchGroups.push({ u1, u2, syncCount });
        }
      }
    }
    results.indicators.synchronized = synchGroups.length;

    // 2) Rare hashtag sequences with TF-IDF weighting
    // Build hashtag usage map first
    const userHashtagSets = new Map();
    filteredData.forEach(post => {
      const userId = post.data?.author?.id;
      const hashtags = post.data?.challenges?.map(c => c.title) || [];
      if (!userId || !hashtags.length) return;
      
      if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
      hashtags.forEach(h => userHashtagSets.get(userId).push(h));
    });

    // Detect with TF-IDF weighting to find rare coordinated hashtag combinations
    const hashtagSequences = new Map();
    filteredData.forEach(post => {
      const userId = post.data?.author?.id;
      const hashtags = post.data?.challenges?.map(c => c.title) || [];
      if (!userId || !hashtags.length) return;
      
      // Calculate TF-IDF score for this hashtag set
      const allSets = Array.from(userHashtagSets.values()).map(arr => new Set(arr));
      const tfidfScore = hashtags.reduce((sum, h) => {
        return sum + calculateTFIDF(h, userHashtagSets.get(userId), allSets);
      }, 0) / hashtags.length;
      
      // Only consider high TF-IDF sequences (rare combinations)
      if (tfidfScore > params.tfidfThreshold) {
        const key = hashtags.sort().join(',');
        if (!hashtagSequences.has(key)) hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
        hashtagSequences.get(key).users.add(userId);
      }
    });

    // Flag groups using rare hashtag combinations
    let identicalHashtagUsers = 0;
    hashtagSequences.forEach((data, key) => {
      if (data.users.size >= params.minHashtagGroupSize) {
        data.users.forEach(u => results.suspiciousUsers.add(u));
        identicalHashtagUsers += data.users.size;
      }
    });
    results.indicators.identicalHashtags = identicalHashtagUsers;

    // 3) Similar usernames with Levenshtein distance
    const usernames = new Map();
    filteredData.forEach(post => {
      const author = post.data?.author;
      if (!author) return;
      const username = author.uniqueId || author.nickname || '';
      const userId = author.id;
      if (username.length < 4) return;
      
      usernames.set(userId, username);
    });

    const usernameGroups = new Map();
    const usernameArray = Array.from(usernames.entries());

    for (let i = 0; i < usernameArray.length; i++) {
      for (let j = i + 1; j < usernameArray.length; j++) {
        const [id1, name1] = usernameArray[i];
        const [id2, name2] = usernameArray[j];
        
        const distance = levenshteinDistance(name1, name2);
        const maxLen = Math.max(name1.length, name2.length);
        const similarity = 1 - (distance / maxLen);
        
        // Check against threshold (default 80%+ similar)
        if (similarity >= params.usernameThreshold) {
          const key = [name1, name2].sort().join('|');
          if (!usernameGroups.has(key)) usernameGroups.set(key, new Set());
          usernameGroups.get(key).add(id1);
          usernameGroups.get(key).add(id2);
        }
      }
    }

    let similarUsernameCount = 0;
    usernameGroups.forEach((users, key) => {
      if (users.size >= params.minUsernameGroupSize) {
        users.forEach(u => results.suspiciousUsers.add(u));
        similarUsernameCount += users.size;
      }
    });
    results.indicators.similarUsernames = similarUsernameCount;

    // 4) High-volume posting with z-score normalization
    results.indicators.highVolume = 0;
    postsByUser.forEach((posts, userId) => {
      if (posts.length >= params.minHighVolumePosts) {
        const zScore = (posts.length - stats.posts.mean) / stats.posts.stdDev;
        
        // Flag if z-score exceeds threshold (default: 2 = 95th percentile)
        if (zScore > params.zscoreThreshold) {
          results.suspiciousUsers.add(userId);
          results.indicators.highVolume++;
        }
      }
    });
    
    // 5) Temporal burst detection
    const bursts = detectTemporalBursts(postsByUser, timeWindow, params.burstPosts);
    results.indicators.temporalBursts = bursts.length;
    
    // 6) Posting rhythm regularity & 24/7 activity
    postsByUser.forEach((posts, userId) => {
      // Check posting rhythm regularity
      const rhythm = analyzePostingRhythm(posts, params.rhythmCV);
      if (rhythm.regular) {
        results.suspiciousUsers.add(userId);
      }
      
      // Check 24/7 posting pattern
      const nightPosting = analyzeNightPosting(posts, params.nightGap);
      if (nightPosting.suspicious) {
        results.suspiciousUsers.add(userId);
      }
    });

    // 7) Semantic duplicate captions (AI-powered similarity)
    let semanticGroups = [];
    
    if (params.semanticEnabled) {
      // Only run if enabled (can be slow on large datasets)
      const captionEmbeddings = new Map();
      
      for (const post of filteredData) {
        const userId = post.data?.author?.id;
        const caption = post.data?.desc || '';
        if (!userId || caption.length < 20) continue;
        
        const embedding = await getEmbedding(caption);
        captionEmbeddings.set(userId, { caption, embedding, userId });
      }
      
      // Compare all pairs for semantic similarity
      const embedArray = Array.from(captionEmbeddings.values());
      for (let i = 0; i < embedArray.length; i++) {
        for (let j = i + 1; j < embedArray.length; j++) {
          const similarity = cosineSimilarity(embedArray[i].embedding, embedArray[j].embedding);
          
          // Check against threshold (default: 0.85 = very similar, paraphrased content)
          if (similarity >= params.semanticThreshold) {
            results.suspiciousUsers.add(embedArray[i].userId);
            results.suspiciousUsers.add(embedArray[j].userId);
            semanticGroups.push({ 
              users: [embedArray[i].userId, embedArray[j].userId],
              similarity: similarity.toFixed(3),
              captions: [embedArray[i].caption.slice(0, 50), embedArray[j].caption.slice(0, 50)]
            });
          }
        }
      }
    }
    
    results.indicators.semanticDuplicates = semanticGroups.length;
    
    // 8) N-gram template captions
    const captionPairs = [];
    const captions = new Map();

    filteredData.forEach(post => {
      const userId = post.data?.author?.id;
      const caption = post.data?.desc || '';
      if (!userId || caption.length < 20) return;
      
      captions.set(userId, caption);
    });

    const captionArray = Array.from(captions.entries());
    for (let i = 0; i < captionArray.length; i++) {
      for (let j = i + 1; j < captionArray.length; j++) {
        const overlap = ngramOverlap(captionArray[i][1], captionArray[j][1]);
        
        // Check against threshold (default: 0.3 = 30% of 5-grams match, template detected)
        if (overlap >= params.ngramThreshold) {
          captionPairs.push({
            users: [captionArray[i][0], captionArray[j][0]],
            overlap: overlap
          });
          results.suspiciousUsers.add(captionArray[i][0]);
          results.suspiciousUsers.add(captionArray[j][0]);
        }
      }
    }

    results.indicators.templateCaptions = captionPairs.length;
    results.indicators.duplicateCaptions = semanticGroups.length + captionPairs.length;
    
    // 9) Account creation clustering
    // Note: Works for Twitter (has account creation dates) and TikTok (if data includes it)
    // Instagram data typically doesn't include account creation dates, so clustering won't work for IG
    const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
    results.indicators.accountCreationClusters = creationClusters.length;
    
    if (creationClusters.length > 0) {
      console.log(`Found ${creationClusters.length} account creation clusters`);
    }

    // Build userId -> username lookup
    const userIdToName = new Map();
    filteredData.forEach(post => {
      const author = post.data?.author;
      if (author?.id) {
        userIdToName.set(author.id, author.uniqueId || author.nickname || `user_${author.id}`);
      }
    });
    
    // risk scores and reasons
    results.userScores = new Map();
    results.userReasons = new Map();
    results.suspiciousUsers.forEach(userId => {
      let score = 0;
      let reasons = [];
      
      // Check synchronized posting
      const userSyncGroups = synchGroups.filter(g => g.u1===userId || g.u2===userId);
      if (userSyncGroups.length > 0) {
        score += 25;
        const partners = userSyncGroups.map(g => {
          const partnerId = g.u1 === userId ? g.u2 : g.u1;
          return userIdToName.get(partnerId) || partnerId;
        }).slice(0, 5);
        const more = userSyncGroups.length > 5 ? ` and ${userSyncGroups.length - 5} more` : '';
        reasons.push(`Synchronized posting with: ${partners.join(', ')}${more}`);
      }
      
      // Check rare hashtag sequences (TF-IDF weighted)
      const userPosts = filteredData.filter(p => p.data?.author?.id === userId);
      const hashtagPartners = [];
      hashtagSequences.forEach((data, seq) => {
        if (data.users.has(userId) && data.users.size >= params.minHashtagGroupSize) {
          const others = Array.from(data.users).filter(u => u !== userId).map(u => userIdToName.get(u) || u);
          hashtagPartners.push(...others);
        }
      });
      if (hashtagPartners.length > 0) {
        score += 20;
        const display = hashtagPartners.slice(0, 5);
        const more = hashtagPartners.length > 5 ? ` and ${hashtagPartners.length - 5} more` : '';
        reasons.push(`Rare hashtag combinations with: ${display.join(', ')}${more}`);
      }
      
      // Check similar username (Levenshtein distance)
      usernameGroups.forEach((users, key) => {
        if (users.has(userId) && users.size >= params.minUsernameGroupSize) {
          score += 10;
          const similarUsers = Array.from(users).filter(u => u !== userId).map(u => userIdToName.get(u) || u);
          const display = similarUsers.slice(0, 5);
          const more = similarUsers.length > 5 ? ` and ${similarUsers.length - 5} more` : '';
          reasons.push(`Similar username pattern with: ${display.join(', ')}${more}`);
        }
      });
      
      // Check high-volume posting (z-score)
      if (userPosts.length >= params.minHighVolumePosts) {
        const zScore = (userPosts.length - stats.posts.mean) / stats.posts.stdDev;
        if (zScore > params.zscoreThreshold) {
          score += 15;
          reasons.push(`High-volume posting (z-score: ${zScore.toFixed(1)})`);
        }
      }
      
      // Check temporal bursts
      const userBursts = bursts.filter(b => b.userId === userId);
      if (userBursts.length > 0) {
        score += 15;
        userBursts.forEach(burst => {
          const timeDesc = timeWindow < 60 ? `${timeWindow} second${timeWindow !== 1 ? 's' : ''}` : 
                           `${Math.floor(timeWindow/60)} minute${Math.floor(timeWindow/60) !== 1 ? 's' : ''}`;
          reasons.push(`Posting burst: ${burst.count} posts in ${timeDesc}`);
        });
      }
      
      // Check posting rhythm regularity
      const rhythm = analyzePostingRhythm(userPosts.map(p => ({ timestamp: p.data?.createTime })).filter(p => p.timestamp), params.rhythmCV);
      if (rhythm.regular) {
        score += 20;
        reasons.push(`Highly regular posting rhythm (CV: ${(rhythm.cv * 100).toFixed(1)}%)`);
      }
      
      // Check 24/7 posting
      const nightPosting = analyzeNightPosting(userPosts.map(p => ({ timestamp: p.data?.createTime })).filter(p => p.timestamp), params.nightGap);
      if (nightPosting.suspicious) {
        score += 25;
        reasons.push(`24/7 posting pattern (max gap: ${Math.floor(nightPosting.avgMaxGap / 3600)}h)`);
      }
      
      // Check semantic duplicate captions
      semanticGroups.forEach(group => {
        if (group.users.includes(userId)) {
          score += 25;
          const partner = group.users.find(u => u !== userId);
          const partnerName = userIdToName.get(partner) || partner;
          reasons.push(`Semantically similar captions (${group.similarity}) with ${partnerName}`);
        }
      });
      
      // Check n-gram template captions
      captionPairs.forEach(pair => {
        if (pair.users.includes(userId)) {
          score += 20;
          const partner = pair.users.find(u => u !== userId);
          const partnerName = userIdToName.get(partner) || partner;
          reasons.push(`Template caption (${(pair.overlap * 100).toFixed(0)}% overlap) with ${partnerName}`);
        }
      });
      
      // Check account creation clusters
      creationClusters.forEach(cluster => {
        if (cluster.has(userId)) {
          score += 30;
          reasons.push(`Account created with ${cluster.size - 1} others within 24 hours`);
        }
      });
      
      results.userScores.set(userId, score);
      results.userReasons.set(userId, reasons);
    });
    
    // Cross-indicator bonus multiplier (multiple indicators = exponentially more suspicious)
    results.suspiciousUsers.forEach(userId => {
      const reasons = results.userReasons.get(userId) || [];
      const numIndicators = reasons.length;
      let baseScore = results.userScores.get(userId) || 0;
      
      // Multiplicative bonus for multiple indicators
      if (numIndicators >= 2) {
        const multiplier = 1 + (params.crossMultiplier * numIndicators);
        baseScore = Math.min(100, baseScore * multiplier);
        results.userScores.set(userId, Math.round(baseScore));
      }
      
      // Extra bonus for specific dangerous combinations
      const reasonText = reasons.join(' ').toLowerCase();
      
      if (reasonText.includes('similar username') && reasonText.includes('created with')) {
        // Username similarity + account creation = bot farm
        const currentScore = results.userScores.get(userId);
        results.userScores.set(userId, Math.min(100, currentScore + 20));
      }
      
      if (reasonText.includes('synchronized') && reasonText.includes('regular posting')) {
        // Synchronization + regularity = automated coordination
        const currentScore = results.userScores.get(userId);
        results.userScores.set(userId, Math.min(100, currentScore + 15));
      }
    });

    cibDetection = results;
    displayCIBResults(results);

    // mark nodes
    if (nodes.length > 0) {
      nodes.forEach(node => {
        const plainId = node.id.replace(/^u_/,'');
        if (results.suspiciousUsers.has(node.id) || results.suspiciousUsers.has(plainId)) {
          node.suspicious = true;
          node.cibScore = results.userScores.get(node.id) || results.userScores.get(plainId) || 0;
          node.cibReasons = results.userReasons.get(node.id) || results.userReasons.get(plainId) || [];
        }
      });
      drawNetwork();
    }
      if (statElements.suspicious) statElements.suspicious.textContent = results.suspiciousUsers.size;

    // Enable CIB export buttons
    exportCsvBtn.disabled = false;
    exportReportBtn.disabled = false;

    loading.classList.remove('active');
    updateCoach();
  }, 100);
}

function displayCIBResults(results) {
  const params = getCibParams(); // Check if semantic is enabled
  
  let html = '<ul class="metrics-list">';
  html += `<li><span class="metric-name">Suspicious Accounts</span><span class="metric-value cib-score">${results.suspiciousUsers.size}</span></li>`;
  html += `<li><span class="metric-name">Synchronized Posting</span><span class="metric-value">${results.indicators.synchronized} pairs</span></li>`;
  html += `<li><span class="metric-name">Rare Hashtag Combos</span><span class="metric-value">${results.indicators.identicalHashtags} users</span></li>`;
  html += `<li><span class="metric-name">Similar Usernames</span><span class="metric-value">${results.indicators.similarUsernames} users</span></li>`;
  html += `<li><span class="metric-name">High Volume Posting</span><span class="metric-value">${results.indicators.highVolume} users</span></li>`;
  
  // New AI-powered indicators
  if (results.indicators.semanticDuplicates > 0) {
    html += `<li><span class="metric-name">🤖 Semantic Duplicates</span><span class="metric-value">${results.indicators.semanticDuplicates} pairs</span></li>`;
  } else if (!params.semanticEnabled) {
    html += `<li><span class="metric-name">🤖 Semantic Duplicates</span><span class="metric-value" style="color: #9ca3af;">disabled</span></li>`;
  }
  
  if (results.indicators.temporalBursts) {
    html += `<li><span class="metric-name">Posting Bursts</span><span class="metric-value">${results.indicators.temporalBursts} users</span></li>`;
  }
  if (results.indicators.templateCaptions) {
    html += `<li><span class="metric-name">Template Captions</span><span class="metric-value">${results.indicators.templateCaptions} pairs</span></li>`;
  }
  if (results.indicators.accountCreationClusters) {
    html += `<li><span class="metric-name">Account Creation Clusters</span><span class="metric-value">${results.indicators.accountCreationClusters} clusters</span></li>`;
  }
  
  html += '</ul>';
  cibResults.innerHTML = html;
  cibPanel.style.display = 'block';
}

// =========================
// Network extraction
// =========================
function extractMentionNetwork(posts) {
  const nodeMap = new Map();
  const links = [];
  
  let debugCount = 0;

  posts.forEach(post => {
    const author = post.data?.author;
    if (!author) {
      console.log('Post missing author:', post.item_id);
      return;
    }

    const authorId = author.id;
    if (!authorId) {
      console.log('Author missing ID:', author);
      return;
    }
    
    if (!nodeMap.has(authorId)) {
      nodeMap.set(authorId, {
        id: authorId,
        label: author.uniqueId || author.nickname,
        verified: author.verified,
        followers: post.data?.authorStats?.followerCount || 0,
        type: 'user'
      });
    }
    const mentions = post.data?.textExtra?.filter(t => t.type === 0) || [];
    
    // Debug first few posts
    if (debugCount < 3 && mentions.length > 0) {
      console.log(`Post ${post.item_id}: authorId=${authorId}, ${mentions.length} mentions`, mentions.map(m => `${m.userUniqueId}(${m.userId})`));
      debugCount++;
    }
    
    mentions.forEach(mention => {
      // Use userId if available, otherwise create ID from username
      const mentionId = mention.userId || `user_${mention.userUniqueId}`;
      if (!mentionId || mentionId === 'user_undefined') return; // Skip invalid mentions
      
      if (!nodeMap.has(mentionId)) {
        nodeMap.set(mentionId, {
          id: mentionId,
          label: mention.userUniqueId || String(mentionId),
          type: 'user', 
          followers: 0
        });
      }
      links.push({ source: authorId, target: mentionId, postId: post.item_id });
    });
  });

  console.log(`Mention network: ${nodeMap.size} nodes, ${links.length} links`);
  return { nodes: Array.from(nodeMap.values()), links };
}

function extractCoHashtagNetwork(posts) {
  const nodeMap = new Map();
  const linkMap = new Map();

  posts.forEach(post => {
    const hashtags = post.data?.challenges || [];
    hashtags.forEach(tag => {
      const tagId = tag.id;
      if (!nodeMap.has(tagId)) nodeMap.set(tagId, { id: tagId, label: tag.title, count: 0, type: 'hashtag' });
      nodeMap.get(tagId).count++;
    });
    for (let i=0;i<hashtags.length;i++){
      for (let j=i+1;j<hashtags.length;j++){
        const source = hashtags[i].id, target = hashtags[j].id;
        const key = [source, target].sort().join('-');
        if (!linkMap.has(key)) linkMap.set(key, { source, target, weight: 0 });
        linkMap.get(key).weight++;
      }
    }
  });
  
  console.log(`Co-hashtag network: ${nodeMap.size} nodes, ${linkMap.size} links`);
  return { nodes: Array.from(nodeMap.values()), links: Array.from(linkMap.values()) };
}

function extractUserHashtagNetwork(posts) {
  const nodeMap = new Map();
  const links = [];

  posts.forEach(post => {
    const author = post.data?.author;
    if (!author) return;

    const authorId = `u_${author.id}`;
    if (!nodeMap.has(authorId)) {
      nodeMap.set(authorId, {
        id: authorId, label: author.uniqueId || author.nickname, type: 'user',
        verified: author.verified, followers: post.data?.authorStats?.followerCount || 0
      });
    }
    const hashtags = post.data?.challenges || [];
    hashtags.forEach(tag => {
      const tagId = `h_${tag.id}`;
      if (!nodeMap.has(tagId)) nodeMap.set(tagId, { id: tagId, label: tag.title, type: 'hashtag', count: 0 });
      nodeMap.get(tagId).count++;
      links.push({ source: authorId, target: tagId, postId: post.item_id });
    });
  });

  return { nodes: Array.from(nodeMap.values()), links };
}

function extractHashtagNetwork(posts) {
  const nodeMap = new Map();
  posts.forEach(post => {
    const hashtags = post.data?.challenges || [];
    hashtags.forEach(tag => {
      if (!nodeMap.has(tag.id)) nodeMap.set(tag.id, { id: tag.id, label: tag.title, count: 0, totalEngagement: 0, type: 'hashtag' });
      const node = nodeMap.get(tag.id);
      node.count++;
      node.totalEngagement += (post.data?.stats?.diggCount || 0);
    });
  });
  return { nodes: Array.from(nodeMap.values()), links: [] };
}

// Instagram-specific: Photo tag network
function extractPhotoTagNetwork(posts) {
  const nodeMap = new Map();
  const links = [];
  
  posts.forEach(post => {
    if (post.platform !== 'instagram') return; // Only Instagram has photo tags
    
    const author = post.data?.author;
    const usertags = post.data?._instagram?.usertags?.in || [];
    
    if (!author || usertags.length === 0) return;
    
    const authorId = `u_${author.id}`;
    if (!nodeMap.has(authorId)) {
      nodeMap.set(authorId, {
        id: authorId,
        label: author.uniqueId || author.nickname,
        type: 'user',
        verified: author.verified,
        followers: 0
      });
    }
    
    // Create connections to tagged users
    usertags.forEach(tag => {
      const taggedUser = tag.user;
      if (!taggedUser) return;
      
      const taggedId = `u_${taggedUser.id}`;
      if (!nodeMap.has(taggedId)) {
        nodeMap.set(taggedId, {
          id: taggedId,
          label: taggedUser.username,
          type: 'user',
          verified: taggedUser.is_verified || false,
          followers: 0
        });
      }
      
      links.push({ source: authorId, target: taggedId, postId: post.item_id });
    });
  });
  
  return { nodes: Array.from(nodeMap.values()), links };
}

// Instagram-specific: Location network
function extractLocationNetwork(posts) {
  const nodeMap = new Map();
  const links = [];
  
  posts.forEach(post => {
    if (post.platform !== 'instagram') return; // Only Instagram has location data
    
    const author = post.data?.author;
    const location = post.data?._instagram?.location;
    
    if (!author || !location) return;
    
    const authorId = `u_${author.id}`;
    if (!nodeMap.has(authorId)) {
      nodeMap.set(authorId, {
        id: authorId,
        label: author.uniqueId || author.nickname,
        type: 'user',
        verified: author.verified,
        followers: 0
      });
    }
    
    const locationId = `loc_${location.pk}`;
    if (!nodeMap.has(locationId)) {
      nodeMap.set(locationId, {
        id: locationId,
        label: location.name,
        type: 'location',
        count: 0,
        lat: location.lat,
        lng: location.lng
      });
    }
    
    nodeMap.get(locationId).count++;
    links.push({ source: authorId, target: locationId, postId: post.item_id });
  });
  
  return { nodes: Array.from(nodeMap.values()), links };
}

// =========================
// Metrics & communities
// =========================
function calculateNetworkMetrics(graph) {
  const n = graph.nodes.length;
  const m = graph.links.length;
  if (n === 0) return null;

  const maxEdges = (n * (n - 1)) / 2;
  const density = maxEdges > 0 ? (m / maxEdges).toFixed(3) : 0;

  const degrees = new Map();
  graph.nodes.forEach(node => degrees.set(node.id, 0));
  graph.links.forEach(link => {
    degrees.set(link.source, (degrees.get(link.source) || 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) || 0) + 1);
  });

  const avgDegree = (Array.from(degrees.values()).reduce((a,b)=>a+b,0) / n).toFixed(2);
  const maxDegree = degrees.size ? Math.max(...Array.from(degrees.values())) : 0;

  graph.nodes.forEach(node => { node.degree = degrees.get(node.id) || 0; });

  let totalClustering = 0, validNodes = 0;
  graph.nodes.forEach(node => {
    const neighbors = new Set();
    graph.links.forEach(link => {
      if (link.source === node.id) neighbors.add(link.target);
      if (link.target === node.id) neighbors.add(link.source);
    });
    const k = neighbors.size;
    if (k < 2) return;
    let triangles = 0;
    const arr = Array.from(neighbors);
    for (let i=0;i<arr.length;i++){
      for (let j=i+1;j<arr.length;j++){
        if (graph.links.some(l => (l.source===arr[i] && l.target===arr[j]) || (l.target===arr[i] && l.source===arr[j]))) triangles++;
      }
    }
    const possible = (k*(k-1))/2;
    if (possible > 0) { totalClustering += triangles/possible; validNodes++; }
  });
  const avgClustering = validNodes > 0 ? (totalClustering / validNodes).toFixed(3) : 0;

  return { nodes: n, edges: m, density, avgDegree, maxDegree, avgClustering };
}

function displayMetrics(metrics) {
  if (!metrics) { metricsPanel.style.display = 'none'; return; }
  metricsList.innerHTML = `
    <li><span class="metric-name">Nodes</span><span class="metric-value">${metrics.nodes}</span></li>
    <li><span class="metric-name">Edges</span><span class="metric-value">${metrics.edges}</span></li>
    <li><span class="metric-name">Density</span><span class="metric-value">${metrics.density}</span></li>
    <li><span class="metric-name">Avg Degree</span><span class="metric-value">${metrics.avgDegree}</span></li>
    <li><span class="metric-name">Max Degree</span><span class="metric-value">${metrics.maxDegree}</span></li>
    <li><span class="metric-name">Clustering</span><span class="metric-value">${metrics.avgClustering}</span></li>
  `;
  metricsPanel.style.display = 'block';
}

function detectCommunities(graph) {
  if (graph.nodes.length === 0 || graph.links.length === 0) return null;

  const adj = new Map();
  graph.nodes.forEach(n => adj.set(n.id, new Set()));
  graph.links.forEach(l => { adj.get(l.source).add(l.target); adj.get(l.target).add(l.source); });

  const labels = new Map();
  graph.nodes.forEach((n,i)=>labels.set(n.id, i));

  let changed = true, iterations = 0;
  const maxIterations = 100;

  while (changed && iterations < maxIterations) {
    changed = false; iterations++;
    const shuffled = [...graph.nodes].sort(() => Math.random()-0.5);
    shuffled.forEach(node => {
      const neighbors = adj.get(node.id); if (neighbors.size===0) return;
      const counts = new Map();
      neighbors.forEach(nb => { const lab = labels.get(nb); counts.set(lab, (counts.get(lab)||0)+1); });
      let best = labels.get(node.id), bestCount = 0;
      counts.forEach((c,lab)=>{ if (c>bestCount){ bestCount=c; best=lab; } });
      if (best !== labels.get(node.id)) { labels.set(node.id, best); changed = true; }
    });
  }
  const uniq = [...new Set(labels.values())];
  const remap = new Map(); uniq.forEach((lab,i)=>remap.set(lab,i));
  const out = new Map(); labels.forEach((lab,id)=>out.set(id, remap.get(lab)));
  return { communities: out, count: uniq.length };
}

// =========================
// Update network
// =========================
function updateNetwork() {
  loading.classList.add('active');
  loadingText.textContent = 'Building network...';

    setTimeout(() => {
      const minEngagement = parseInt(engagementFilter.value, 10);
      const startDateValue = dateStart.value ? new Date(dateStart.value).getTime() / 1000 : undefined;
      const endDateValue = dateEnd.value ? (new Date(dateEnd.value).getTime() / 1000) + 86399 : undefined;

      const filtered = filterData(rawData, {
        minEngagement,
        startDate: startDateValue,
        endDate: endDateValue,
        onDebug(post, details) {
          console.log(`Filter Debug - Post ${post.item_id}:`, details);
        },
      });
      filteredData = filtered;
      console.log(`Filtered: ${filteredData.length} posts out of ${rawData.length} (${rawData.length - filteredData.length} filtered out). MinEngagement: ${minEngagement}, DateRange: ${dateStart.value || 'none'} - ${dateEnd.value || 'none'}`);
      const networkType = networkTypeSelect.value;

      let network;
    switch (networkType) {
      case 'mention':     network = extractMentionNetwork(filtered);     break;
      case 'coHashtag':   network = extractCoHashtagNetwork(filtered);   break;
      case 'userHashtag': network = extractUserHashtagNetwork(filtered); break;
      case 'hashtag':     network = extractHashtagNetwork(filtered);     break;
      case 'photoTag':    network = extractPhotoTagNetwork(filtered);    break;
      case 'location':    network = extractLocationNetwork(filtered);    break;
      default:            network = { nodes: [], links: [] };
    }

      graphData = network;
      communities = null;
      cibDetection = null;

      networkMetrics = calculateNetworkMetrics(network);
      displayMetrics(networkMetrics);

      if (statElements.nodes) statElements.nodes.textContent = network.nodes.length;
      if (statElements.edges) statElements.edges.textContent = network.links.length;
      if (statElements.density) statElements.density.textContent = networkMetrics ? networkMetrics.density : '0';
      if (statElements.communities) statElements.communities.textContent = '0';
      if (statElements.suspicious) statElements.suspicious.textContent = '0';

    cibPanel.style.display = 'none';

    // Check if network is empty
    if (network.nodes.length === 0 || network.links.length === 0) {
      loading.classList.remove('active');
      loadingText.textContent = `No ${networkType === 'mention' ? 'mentions' : 
                                  networkType === 'coHashtag' ? 'co-hashtags' : 
                                  networkType === 'hashtag' ? 'hashtags' : 
                                  networkType === 'userHashtag' ? 'user-hashtag connections' : 
                                  networkType === 'photoTag' ? 'photo tags' : 
                                  'location connections'} found in this dataset. Try a different network type.`;
      setTimeout(() => { loadingText.textContent = ''; }, 5000);
      return;
    }

    // Build adjacency (for degree/hover-neighbor glow) and an id->node map
    buildAdjacency(graphData);
    idToNode = new Map(graphData.nodes.map(n => [n.id, n]));

    initializeVisualization();
    loading.classList.remove('active');
    updateCoach();
  }, 100);
}

// =========================
// GPU Renderer (WebGL)
// =========================
class GPUNetworkRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.edgeProgram = null;
    this.nodeProgram = null;
    this.edgeBuffers = null;
    this.nodeBuffers = null;
    this.textRenderer = null;
    this.initialized = false;
    
    this.initWebGL();
  }

  initWebGL() {
    console.log('=== WebGL Context Creation Diagnostics ===');
    console.log('Canvas element:', this.canvas);
    console.log('Canvas dimensions:', {
      width: this.canvas.width,
      height: this.canvas.height,
      offsetWidth: this.canvas.offsetWidth,
      offsetHeight: this.canvas.offsetHeight
    });
    
    try {
      // ✅ CRITICAL CHECK: Does canvas already have a NON-WebGL context?
      // IMPORTANT: Do NOT call getContext('2d') here — that would CREATE a 2D context.
      if (this.canvas.__ctxType && this.canvas.__ctxType !== 'webgl' && this.canvas.__ctxType !== 'webgl2') {
        console.error('❌ FATAL ERROR: Canvas already initialized with a non-WebGL context (' + this.canvas.__ctxType + ')');
        console.error('❌ Cannot create WebGL context on a canvas with an existing non-WebGL context');
        return false;
      }
      
      // CRITICAL FIX: Store and completely reset canvas state
      const computedStyle = window.getComputedStyle(this.canvas);
      const originalDisplay = computedStyle.display;
      const originalPosition = computedStyle.position;
      const originalVisibility = computedStyle.visibility;
      const originalTransform = computedStyle.transform;
      const originalOpacity = computedStyle.opacity;
      
      // CRITICAL FIX: Ensure canvas has proper dimensions BEFORE context creation
      const rect = this.canvas.getBoundingClientRect();
      if (this.canvas.width === 0 || this.canvas.height === 0) {
        console.log('❌ CRITICAL ISSUE: Canvas has zero dimensions - fixing...');
        this.canvas.width = Math.max(rect.width || this.canvas.offsetWidth || 800, 1);
        this.canvas.height = Math.max(rect.height || this.canvas.offsetHeight || 600, 1);
        console.log('✅ Fixed canvas dimensions:', {
          width: this.canvas.width,
          height: this.canvas.height
        });
      }
      
      // CRITICAL FIX: Temporarily remove any CSS that might interfere with WebGL
      // This is the key fix - CSS transforms and certain positioning can break WebGL
      this.canvas.style.setProperty('transform', 'none', 'important');
      this.canvas.style.setProperty('opacity', '1', 'important');
      this.canvas.style.setProperty('visibility', 'visible', 'important');
      this.canvas.style.setProperty('display', 'block', 'important');
      this.canvas.style.setProperty('position', 'static', 'important');
      this.canvas.style.setProperty('will-change', 'auto', 'important');
      this.canvas.style.setProperty('contain', 'none', 'important');
      
      // Force a reflow to apply the style changes
      this.canvas.offsetHeight;
      
      console.log('🔍 Testing WebGL with cleaned canvas state...');
      
      // CRITICAL FIX: Try WebGL context creation with optimal settings
      const contextAttributes = {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false
      };
      
      // Try WebGL 2 first (better performance), then WebGL 1
      this.gl = this.canvas.getContext('webgl2', contextAttributes) ||
                this.canvas.getContext('webgl', contextAttributes) ||
                this.canvas.getContext('experimental-webgl', contextAttributes);
      
      if (!this.gl) {
        console.error('❌ WebGL context creation failed');
        console.error('❌ Possible causes:');
        console.error('   1. Browser extensions blocking WebGL (privacy/ad blockers)');
        console.error('   2. Hardware acceleration disabled in browser settings');
        console.error('   3. GPU blacklisted or unsupported');
        console.error('   4. Canvas already has a different context type');
        console.error('');
        console.error('💡 Try:');
        console.error('   - Open in incognito/private mode');
        console.error('   - Disable browser extensions temporarily');
        console.error('   - Check browser hardware acceleration settings');
        
        // Show user-friendly notification
        this.showWebGLDisabledNotification();
        console.warn('WebGL not supported, falling back to CPU rendering');
        return false;
      }
      
      // Tag the canvas so future checks don't probe/instantiate other contexts
      this.canvas.__ctxType = (this.gl.getParameter(this.gl.VERSION).indexOf('WebGL 2') !== -1) ? 'webgl2' : 'webgl';
      
      console.log('✅ WebGL context created successfully');
      console.log('WebGL context type:', this.gl.constructor.name);
      
      // CRITICAL FIX: Test if context is actually functional
      try {
        const gl = this.gl;
        gl.clearColor(1.0, 1.0, 1.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Test basic drawing setup
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        console.log('✅ WebGL context is functional');
        
        // Log WebGL capabilities
        console.log('WebGL Version:', gl.getParameter(gl.VERSION));
        console.log('WebGL Vendor:', gl.getParameter(gl.VENDOR));
        console.log('WebGL Renderer:', gl.getParameter(gl.RENDERER));
        
        // Create shaders and buffers
        console.log('Creating WebGL shaders and buffers...');
        const shadersCreated = this.createShaders();
        const buffersCreated = this.createBuffers();
        
        console.log('Shader creation result:', shadersCreated);
        console.log('Buffer creation result:', buffersCreated);
        
        if (shadersCreated && buffersCreated) {
          this.initialized = true;
          console.log('✅ WebGL renderer fully initialized');
          
          // CRITICAL FIX: Don't restore canvas styles that could break WebGL
          // Keep the canvas in the clean state needed for WebGL
          this.canvas.style.setProperty('transform', 'none', 'important');
          this.canvas.style.setProperty('opacity', '1', 'important');
          this.canvas.style.setProperty('visibility', 'visible', 'important');
          this.canvas.style.setProperty('display', 'block', 'important');
          this.canvas.style.setProperty('position', 'static', 'important');
          
          return true;
        } else {
          console.error('❌ Failed to create shaders or buffers');
          return false;
        }
      } catch (glError) {
        console.error('❌ WebGL context is not functional:', glError);
        console.error('❌ Context created but drawing operations fail');
        return false;
      }
    } catch (error) {
      console.error('❌ WebGL initialization threw exception:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  showWebGLDisabledNotification() {
    // Create a user-friendly notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #dc2626;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 400px;
      line-height: 1.4;
    `;
    notification.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">⚠️ WebGL Disabled</div>
      <div style="font-size: 12px; margin-bottom: 8px;">Browser extensions or security policies are blocking WebGL.</div>
      <div style="font-size: 11px; opacity: 0.9;">Try disabling extensions or using incognito mode.</div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 8000);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
  }

  createShaders() {
    const gl = this.gl;
    
    // Edge shader - draws lines between nodes
    const edgeVertexSource = `
      attribute vec2 a_position;
      attribute vec3 a_color;
      attribute float a_alpha;
      uniform vec2 u_resolution;
      varying vec3 v_color;
      varying float v_alpha;
      
      void main() {
        vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        v_color = a_color;
        v_alpha = a_alpha;
      }
    `;
    
    const edgeFragmentSource = `
      precision mediump float;
      varying vec3 v_color;
      varying float v_alpha;
      
      void main() {
        gl_FragColor = vec4(v_color, v_alpha);
      }
    `;
    
    // Node shader - draws circles for nodes
    const nodeVertexSource = `
      attribute vec2 a_position;
      attribute vec3 a_color;
      attribute float a_radius;
      attribute float a_borderWidth;
      attribute vec3 a_borderColor;
      uniform vec2 u_resolution;
      varying vec3 v_color;
      varying float v_radius;
      varying float v_borderWidth;
      varying vec3 v_borderColor;
      
      void main() {
        vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        v_color = a_color;
        v_radius = a_radius;
        v_borderWidth = a_borderWidth;
        v_borderColor = a_borderColor;
        gl_PointSize = a_radius * 2.0 + a_borderWidth * 2.0;
      }
    `;
    
    const nodeFragmentSource = `
      precision mediump float;
      varying vec3 v_color;
      varying float v_radius;
      varying float v_borderWidth;
      varying vec3 v_borderColor;
      
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        
        if (dist > 0.5) {
          discard;
        }
        
        float totalRadius = v_radius + v_borderWidth;
        float normalizedDist = dist * 2.0; // 0 at center, 1 at edge
        
        if (v_borderWidth > 0.0 && normalizedDist > (v_radius / totalRadius)) {
          gl_FragColor = vec4(v_borderColor, 1.0);
        } else {
          gl_FragColor = vec4(v_color, 1.0);
        }
      }
    `;
    
    this.edgeProgram = this.createProgram(edgeVertexSource, edgeFragmentSource);
    this.nodeProgram = this.createProgram(nodeVertexSource, nodeFragmentSource);
    
    // Return true if both programs were created successfully
    return !!(this.edgeProgram && this.nodeProgram);
  }

  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  createBuffers() {
    const gl = this.gl;
    
    try {
      // Edge buffers
      this.edgeBuffers = {
        position: gl.createBuffer(),
        color: gl.createBuffer(),
        alpha: gl.createBuffer()
      };
      
      // Node buffers
      this.nodeBuffers = {
        position: gl.createBuffer(),
        color: gl.createBuffer(),
        radius: gl.createBuffer(),
        borderWidth: gl.createBuffer(),
        borderColor: gl.createBuffer()
      };
      
      // Check if all buffers were created successfully
      const edgeBuffersValid = this.edgeBuffers.position && this.edgeBuffers.color && this.edgeBuffers.alpha;
      const nodeBuffersValid = this.nodeBuffers.position && this.nodeBuffers.color && 
                             this.nodeBuffers.radius && this.nodeBuffers.borderWidth && this.nodeBuffers.borderColor;
      
      return !!(edgeBuffersValid && nodeBuffersValid);
    } catch (error) {
      console.error('Buffer creation failed:', error);
      return false;
    }
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ] : [0.5, 0.5, 0.5];
  }

  render(nodes, edges, width, height) {
    if (!this.initialized) return false;
    
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    this.renderEdges(edges, width, height);
    this.renderNodes(nodes, width, height);
    
    return true;
  }

  renderEdges(edges, width, height) {
    if (edges.length === 0) return;
    
    const gl = this.gl;
    gl.useProgram(this.edgeProgram);
    
    // Prepare edge data
    const positions = [];
    const colors = [];
    const alphas = [];
    
    edges.forEach(edge => {
      if (!edge.source || !edge.target) return;
      
      // Use idToNode map for better performance (optimization)
      const source = idToNode.get(edge.source);
      const target = idToNode.get(edge.target);
      if (!source || !target) return;
      
      // Create line segment
      positions.push(source.x, source.y, target.x, target.y);
      
      const weight = edge.weight || 1;
      const alpha = Math.min(0.3 + weight * 0.1, 0.8);
      const color = this.hexToRgb('#d1d5db');
      
      colors.push(...color, ...color);
      alphas.push(alpha, alpha);
    });
    
    if (positions.length === 0) return;
    
    // Set uniforms
    const resolutionLocation = gl.getUniformLocation(this.edgeProgram, 'u_resolution');
    if (resolutionLocation) {
      gl.uniform2f(resolutionLocation, width, height);
    }
    
    // Set attributes
    const positionLocation = gl.getAttribLocation(this.edgeProgram, 'a_position');
    if (positionLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }
    
    const colorLocation = gl.getAttribLocation(this.edgeProgram, 'a_color');
    if (colorLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
    }
    
    const alphaLocation = gl.getAttribLocation(this.edgeProgram, 'a_alpha');
    if (alphaLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffers.alpha);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alphas), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(alphaLocation);
      gl.vertexAttribPointer(alphaLocation, 1, gl.FLOAT, false, 0, 0);
    }
    
    // Draw edges as lines
    gl.drawArrays(gl.LINES, 0, positions.length / 2);
  }

  renderNodes(nodes, width, height) {
    if (nodes.length === 0) return;
    
    const gl = this.gl;
    gl.useProgram(this.nodeProgram);
    
    // Prepare node data
    const positions = [];
    const colors = [];
    const radii = [];
    const borderWidths = [];
    const borderColors = [];
    
    nodes.forEach(node => {
      positions.push(node.x, node.y);
      
      const color = this.hexToRgb(getNodeColor(node));
      colors.push(...color);
      
      const radius = nodeSize(node);
      radii.push(radius);
      
      // Border styling
      if (node.suspicious) {
        borderWidths.push(3);
        borderColors.push(...this.hexToRgb('#7f1d1d'));
      } else if (radius > 12) {
        borderWidths.push(2);
        borderColors.push(...this.hexToRgb('#ffffff'));
      } else {
        borderWidths.push(0);
        borderColors.push(...color);
      }
    });
    
    // Set uniforms
    const resolutionLocation = gl.getUniformLocation(this.nodeProgram, 'u_resolution');
    if (resolutionLocation) {
      gl.uniform2f(resolutionLocation, width, height);
    }
    
    // Set attributes manually with proper error checking
    const positionLocation = gl.getAttribLocation(this.nodeProgram, 'a_position');
    if (positionLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }
    
    const colorLocation = gl.getAttribLocation(this.nodeProgram, 'a_color');
    if (colorLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
    }
    
    const radiusLocation = gl.getAttribLocation(this.nodeProgram, 'a_radius');
    if (radiusLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffers.radius);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(radii), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(radiusLocation);
      gl.vertexAttribPointer(radiusLocation, 1, gl.FLOAT, false, 0, 0);
    }
    
    const borderWidthLocation = gl.getAttribLocation(this.nodeProgram, 'a_borderWidth');
    if (borderWidthLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffers.borderWidth);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(borderWidths), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(borderWidthLocation);
      gl.vertexAttribPointer(borderWidthLocation, 1, gl.FLOAT, false, 0, 0);
    }
    
    const borderColorLocation = gl.getAttribLocation(this.nodeProgram, 'a_borderColor');
    if (borderColorLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffers.borderColor);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(borderColors), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(borderColorLocation);
      gl.vertexAttribPointer(borderColorLocation, 3, gl.FLOAT, false, 0, 0);
    }
    
    // Draw nodes as points
    gl.drawArrays(gl.POINTS, 0, nodes.length);
  }

  setAttribute(program, name, data, size) {
    const gl = this.gl;
    const location = gl.getAttribLocation(program, name);
    const buffer = name.includes('position') ? this.nodeBuffers.position :
                   name.includes('color') ? this.nodeBuffers.color :
                   name.includes('radius') ? this.nodeBuffers.radius :
                   name.includes('borderWidth') ? this.nodeBuffers.borderWidth :
                   name.includes('borderColor') ? this.nodeBuffers.borderColor :
                   this.edgeBuffers.position;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  renderLabels(nodes, width, height) {
    // CRITICAL FIX: Cannot create 2D context on canvas with WebGL context
    // Instead, create a temporary overlay canvas for text rendering
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '1';
    
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#1f2937';
    
    nodes.forEach(node => {
      const radius = nodeSize(node);
      if (radius > 8) {
        const label = (node.label || '').substring(0, 20);
        ctx.fillText(label, node.x, node.y - radius - 5);
      }
    });
    
    ctx.restore();
    
    // Replace any existing overlay
    const existingOverlay = this.canvas.parentNode.querySelector('.text-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Add the overlay
    overlayCanvas.className = 'text-overlay';
    this.canvas.parentNode.appendChild(overlayCanvas);
  }

  renderArrows(edges, width, height) {
    // Render arrows on overlay for GPU mode (WebGL arrows are complex)
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '0.5';
    
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.save();
    edges.forEach(edge => {
      const s = idToNode.get(edge.source);
      const t = idToNode.get(edge.target);
      if (!s || !t) return;
      
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const targetRadius = nodeSize(t);
      const arrowSize = Math.min(8, targetRadius * 0.6);
      const arrowX = t.x - Math.cos(angle) * (targetRadius + 2);
      const arrowY = t.y - Math.sin(angle) * (targetRadius + 2);
      
      const w = edge.weight || 1;
      ctx.globalAlpha = Math.min(0.3 + w * 0.1, 0.8);
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
    
    // Replace any existing arrow overlay
    const existingOverlay = this.canvas.parentNode.querySelector('.arrow-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Add the overlay
    overlayCanvas.className = 'arrow-overlay';
    this.canvas.parentNode.appendChild(overlayCanvas);
  }

  cleanup() {
    if (!this.initialized) return;
    
    const gl = this.gl;
    Object.values(this.edgeBuffers).forEach(buffer => gl.deleteBuffer(buffer));
    Object.values(this.nodeBuffers).forEach(buffer => gl.deleteBuffer(buffer));
    
    if (this.edgeProgram) gl.deleteProgram(this.edgeProgram);
    if (this.nodeProgram) gl.deleteProgram(this.nodeProgram);
  }
}

// =========================
// Layouts & drawing (GPU-accelerated)
// =========================
function applyForceLayout() {
  const centerX = canvas.width / 2, centerY = canvas.height / 2;
  const maxRepulsionDist = 300; // Skip repulsion for distant nodes (optimization)
  
  nodes.forEach(node => {
    nodes.forEach(other => {
      if (node === other) return;
      const dx = node.x - other.x, dy = node.y - other.y;
      const distSq = dx*dx + dy*dy;
      
      // Skip repulsion for very distant nodes (optimization)
      if (distSq > maxRepulsionDist * maxRepulsionDist) return;
      
      const dist = Math.sqrt(distSq) || 1;
      const force = Math.min(1000 / distSq, 10);
      node.vx += (dx / dist) * force;
      node.vy += (dy / dist) * force;
    });
    graphData.links.forEach(link => {
      // Use idToNode map for better performance (optimization)
      const source = idToNode.get(link.source);
      const target = idToNode.get(link.target);
      if (!source || !target) return;
      if (node === source) {
        const dx = target.x - source.x, dy = target.y - source.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = (dist - 150) * 0.05;
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
    });
    node.vx += (centerX - node.x) * 0.002;
    node.vy += (centerY - node.y) * 0.002;
    node.vx *= 0.85; node.vy *= 0.85;
    node.x += node.vx; node.y += node.vy;
    const margin = 30;
    node.x = Math.max(margin, Math.min(canvas.width - margin, node.x));
    node.y = Math.max(margin, Math.min(canvas.height - margin, node.y));
  });
}

function initializeVisualization() {
  if (!graphData || graphData.nodes.length === 0) {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  nodes = graphData.nodes.map(n => ({
    ...n,
    x: canvas.width/2 + (Math.random()-0.5)*100,
    y: canvas.height/2 + (Math.random()-0.5)*100,
    vx: 0, vy: 0
  }));

  // Update global nodes reference for WebGL renderer
  window.nodes = nodes;
  
  // Rebuild idToNode map with positioned nodes (fix for highlight bug)
  idToNode = new Map(nodes.map(n => [n.id, n]));

  // CRITICAL FIX: Initialize GPU renderer FIRST, before any 2D context creation
  // This prevents the "Canvas already has a 2D context" error
  if (!gpuRenderer) {
    console.log('Attempting GPU renderer initialization...');
    gpuRenderer = new GPUNetworkRenderer(canvas);
    
    if (!gpuRenderer || !gpuRenderer.initialized) {
      console.log('GPU renderer failed, will use CPU rendering');
      gpuRenderer = null;
      // Only create 2D context if WebGL failed
      if (!ctx) {
        if (!gl && !gpuRenderer) {
          ctx = canvas.getContext('2d');
          canvas.__ctxType = '2d';
        }
      }
    }
  }

  startAnimation();
}

function startAnimation() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  let iteration = 0, maxIterations = 200;
  function animate() {
    if (iteration++ > maxIterations) return;
    applyForceLayout(); drawNetwork();
    animationFrame = requestAnimationFrame(animate);
  }
  animate();
}

function getNodeColor(node) {
  if (node.suspicious) return '#dc2626';
  if (communities && communities.communities.has(node.id)) {
    const cid = communities.communities.get(node.id);
    return communityColors[cid % communityColors.length];
  }
  if (node.type === 'user') return node.verified ? '#3b82f6' : '#8b5cf6';
  if (node.type === 'location') return '#f59e0b'; // Orange for locations
  return '#10b981'; // Green for hashtags
}

function nodeSize(n) {
  const sizeBy = nodeSizeBySelect.value;
  
  switch (sizeBy) {
    case 'degree':
      const degree = n.degree || 0;
      return Math.min(5 + Math.sqrt(degree) * 3, 30);
    
    case 'followers':
      if (n.type === 'user') {
        return Math.min(5 + Math.log((n.followers || 0) + 1) * 1.5, 25);
      } else {
        // For hashtags and locations, size by count
        return Math.min(5 + (n.count || 1) * 1.5, 25);
      }
    
    case 'uniform':
      return 8;
    
    default:
      return 8;
  }
}

function drawNetwork() {
  // Clean up any existing overlays before redrawing
  cleanupOverlays();
  
  // Try GPU rendering first, fallback to CPU if needed
  if (gpuRenderer && gpuRenderer.initialized) {
    const success = gpuRenderer.render(nodes, graphData.links, canvas.width, canvas.height);
    if (success) {
      // Render arrows and labels using Canvas 2D overlays
      gpuRenderer.renderArrows(graphData.links, canvas.width, canvas.height);
      gpuRenderer.renderLabels(nodes, canvas.width, canvas.height);
      updateRenderingIndicator(true);
      return;
    }
  }
  
  // Fallback to CPU rendering
  drawNetworkCPU();
  updateRenderingIndicator(false);
}

function cleanupOverlays() {
  // Remove any existing overlay canvases
  const container = canvas.parentNode;
  const overlays = container.querySelectorAll('.text-overlay, .arrow-overlay, .highlight-overlay, .search-highlight-overlay, .hover-overlay');
  overlays.forEach(overlay => overlay.remove());
}

function updateRenderingIndicator(isGPU) {
  if (isGPU) {
    renderingIndicator.textContent = '🚀 GPU rendering';
    renderingIndicator.style.color = '#10b981';
  } else {
    renderingIndicator.textContent = '⚙ CPU rendering';
    renderingIndicator.style.color = '#f59e0b';
  }
}

function drawNetworkCPU() {
  // Create 2D context on demand if not already created
  if (!ctx) {
    if (!gl && !gpuRenderer) {
      ctx = canvas.getContext('2d');
      canvas.__ctxType = '2d';
    }
    if (!ctx) {
      console.error('Failed to create 2D context');
      return;
    }
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // edges (use idToNode map instead of find for better performance)
  graphData.links.forEach(link => {
    const s = idToNode.get(link.source);
    const t = idToNode.get(link.target);
    if (!s || !t) return;
    const w = link.weight || 1;
    ctx.lineWidth = Math.min(1 + w*0.5, 5);
    ctx.strokeStyle = '#d1d5db';
    ctx.globalAlpha = Math.min(0.3 + w*0.1, 0.8);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    
    // Draw arrowhead to show direction
    const angle = Math.atan2(t.y - s.y, t.x - s.x);
    const targetRadius = nodeSize(t);
    const arrowSize = Math.min(8, targetRadius * 0.6);
    const arrowX = t.x - Math.cos(angle) * (targetRadius + 2);
    const arrowY = t.y - Math.sin(angle) * (targetRadius + 2);
    
    ctx.fillStyle = '#d1d5db';
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    
    ctx.globalAlpha = 1;
  });

  // nodes
  nodes.forEach(n => {
    const r = nodeSize(n);
    ctx.fillStyle = getNodeColor(n);
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI*2); ctx.fill();

    if (r > 12 || n.suspicious) {
      ctx.strokeStyle = n.suspicious ? '#7f1d1d' : 'white';
      ctx.lineWidth = n.suspicious ? 3 : 2; ctx.stroke();
    }

    if (r > 8) {
      ctx.fillStyle = '#1f2937';
      ctx.font = `${Math.min(r*0.8, 12)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = (n.label || '').substring(0, 20);
      ctx.fillText(label, n.x, n.y - r - 5);
    }
  });
}

// =========================
// Hover & Click UX
// =========================
function getNodeAt(x, y) {
  if (!nodes?.length) return null;
  let best = null, bestDist = Infinity;
  for (const n of nodes) {
    const r = nodeSize(n);
    const d = Math.hypot(x - n.x, y - n.y);
    if (d <= r && d < bestDist) { best = n; bestDist = d; }
  }
  return best;
}

function buildAdjacency(graph) {
  adjacency = new Map();
  graph.nodes.forEach(n => adjacency.set(n.id, new Set()));
  graph.links.forEach(l => {
    if (adjacency.has(l.source)) adjacency.get(l.source).add(l.target);
    if (adjacency.has(l.target)) adjacency.get(l.target).add(l.source);
  });
  graph.nodes.forEach(n => { n.degree = adjacency.get(n.id)?.size || 0; });
}

function postEngagement(p) {
  const s = p?.data?.stats || {};
  return (s.diggCount||0) + (s.commentCount||0) + (s.shareCount||0);
}

function getAllPostsForNode(node) {
  if (!filteredData?.length) return [];
  const out = [];
  if (node.type === 'user') {
    const wantId = (node.id + '').replace(/^u_/,'');
    for (const p of filteredData) {
      const a = p?.data?.author || {};
      if (String(a.id) === wantId || (a.uniqueId && node.label && a.uniqueId.toLowerCase() === node.label.toLowerCase())) {
        out.push(p);
      }
    }
  } else if (node.type === 'hashtag') {
    const wantId = (node.id + '').replace(/^h_/,'');
    const wantLabel = (node.label || '').toLowerCase();
    for (const p of filteredData) {
      const hs = p?.data?.challenges || [];
      if (hs.some(h => String(h.id) === wantId || (h.title && h.title.toLowerCase() === wantLabel))) out.push(p);
    }
  } else if (node.type === 'location') {
    const wantId = (node.id + '').replace(/^loc_/,'');
    const wantLabel = (node.label || '').toLowerCase();
    for (const p of filteredData) {
      const loc = p?.data?._instagram?.location;
      if (loc && (String(loc.pk) === wantId || (loc.name && loc.name.toLowerCase() === wantLabel))) {
        out.push(p);
      }
    }
  }
  out.sort((a,b)=>postEngagement(b)-postEngagement(a));
  return out;
}

function samplePostsForNode(node, limit=5) {
  return getAllPostsForNode(node).slice(0, limit);
}

function highlightNeighbors(node) {
  const nbs = adjacency.get(node.id) || new Set();
  
  // For GPU rendering, we need to render the highlight effect
  if (gpuRenderer && gpuRenderer.initialized) {
    // Create highlight data for GPU rendering
    const highlightNodes = [];
    for (const id of nbs) {
      const nb = idToNode.get(id); 
      if (!nb) continue;
      highlightNodes.push({
        x: nb.x,
        y: nb.y,
        radius: nodeSize(nb) + 8,
        color: [1.0, 0.96, 0.42], // #fde68a in RGB
        alpha: 0.15
      });
    }
    renderHighlightGlow(highlightNodes, node, nbs);
  } else {
    // Fallback to CPU rendering - highlight neighbor nodes
  ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = '#fde68a';
  for (const id of nbs) {
    const nb = idToNode.get(id); if (!nb) continue;
    ctx.beginPath(); ctx.arc(nb.x, nb.y, nodeSize(nb)+8, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
    
    // Highlight connected edges
    ctx.save();
    graphData.links.forEach(link => {
      const isConnected = (link.source === node.id && nbs.has(link.target)) ||
                         (link.target === node.id && nbs.has(link.source));
      if (!isConnected) return;
      
      // Use idToNode map for better performance (optimization)
      const s = idToNode.get(link.source);
      const t = idToNode.get(link.target);
      if (!s || !t) return;
      
      const w = link.weight || 1;
      ctx.lineWidth = Math.min(2 + w*0.5, 6);
      ctx.strokeStyle = '#fbbf24'; // Amber color for highlighted edges
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); 
      ctx.moveTo(s.x, s.y); 
      ctx.lineTo(t.x, t.y); 
      ctx.stroke();
      
      // Draw arrowhead on highlighted edge
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const targetRadius = nodeSize(t);
      const arrowSize = Math.min(10, targetRadius * 0.7);
      const arrowX = t.x - Math.cos(angle) * (targetRadius + 2);
      const arrowY = t.y - Math.sin(angle) * (targetRadius + 2);
      
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }
}

function renderHighlightGlow(highlightNodes, node, nbs) {
  // CRITICAL FIX: Cannot create 2D context on canvas with WebGL context
  // Create a temporary overlay canvas for highlight effects
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.top = '0';
  overlayCanvas.style.left = '0';
  overlayCanvas.style.pointerEvents = 'none';
  overlayCanvas.style.zIndex = '2';
  
  const tempCtx = overlayCanvas.getContext('2d');
  
  // Draw highlighted edges first (so they appear behind nodes)
  if (node && nbs) {
    tempCtx.save();
    graphData.links.forEach(link => {
      const isConnected = (link.source === node.id && nbs.has(link.target)) ||
                         (link.target === node.id && nbs.has(link.source));
      if (!isConnected) return;
      
      // Use idToNode map for better performance (optimization)
      const s = idToNode.get(link.source);
      const t = idToNode.get(link.target);
      if (!s || !t) return;
      
      const w = link.weight || 1;
      tempCtx.lineWidth = Math.min(2 + w*0.5, 6);
      tempCtx.strokeStyle = '#fbbf24'; // Amber color for highlighted edges
      tempCtx.globalAlpha = 0.8;
      tempCtx.beginPath(); 
      tempCtx.moveTo(s.x, s.y); 
      tempCtx.lineTo(t.x, t.y); 
      tempCtx.stroke();
      
      // Draw arrowhead on highlighted edge
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const targetRadius = nodeSize(t);
      const arrowSize = Math.min(10, targetRadius * 0.7);
      const arrowX = t.x - Math.cos(angle) * (targetRadius + 2);
      const arrowY = t.y - Math.sin(angle) * (targetRadius + 2);
      
      tempCtx.fillStyle = '#fbbf24';
      tempCtx.beginPath();
      tempCtx.moveTo(arrowX, arrowY);
      tempCtx.lineTo(
        arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      tempCtx.lineTo(
        arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      tempCtx.closePath();
      tempCtx.fill();
    });
    tempCtx.restore();
  }
  
  // Draw highlighted nodes
  tempCtx.save();
  highlightNodes.forEach(node => {
    tempCtx.globalAlpha = node.alpha;
    tempCtx.fillStyle = `rgb(${Math.floor(node.color[0]*255)}, ${Math.floor(node.color[1]*255)}, ${Math.floor(node.color[2]*255)})`;
    tempCtx.beginPath();
    tempCtx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    tempCtx.fill();
  });
  tempCtx.restore();
  
  // Remove any existing highlight overlay
  const existingHighlight = canvas.parentNode.querySelector('.highlight-overlay');
  if (existingHighlight) {
    existingHighlight.remove();
  }
  
  // Add the highlight overlay
  overlayCanvas.className = 'highlight-overlay';
  canvas.parentNode.appendChild(overlayCanvas);
}

canvas.addEventListener('mousemove', (e) => {
  if (!nodes?.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  const n = getNodeAt(x, y);
  if (n) {
    hoveredNode = n;
    canvas.classList.add('hovering');

    // tooltip content
    const deg = n.degree ?? 0;
    const label = n.label ?? n.id;
    let prefix = '';
    if (n.type === 'user') prefix = '@';
    else if (n.type === 'hashtag') prefix = '#';
    else if (n.type === 'location') prefix = '📍';
    
    const meta = (n.type==='user')
      ? `${n.verified?'Verified · ':''}${(n.followers||0).toLocaleString()} followers`
      : `${n.count||0} posts`;

    tooltipEl.innerHTML =
      `<div style="font-weight:600">${prefix}${label}</div>
       <div style="opacity:.85">${n.type} · degree ${deg}${meta ? ' · ' + meta : ''}</div>`;
    tooltipEl.style.display = 'block';

    // place tooltip
    const pad = 12;
    let tx = e.clientX + 12, ty = e.clientY + 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    tooltipEl.style.left = tx + 'px'; tooltipEl.style.top = ty + 'px';
    const tb = tooltipEl.getBoundingClientRect();
    if (tx + tb.width + pad > vw) tooltipEl.style.left = (vw - tb.width - pad) + 'px';
    if (ty + tb.height + pad > vh) tooltipEl.style.top  = (vh - tb.height - pad) + 'px';

    // redraw with neighbor glow + ring
    drawNetwork();
    highlightNeighbors(n);
    
    // Draw hover ring using overlay to avoid context conflicts
    const hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = canvas.width;
    hoverCanvas.height = canvas.height;
    hoverCanvas.style.position = 'absolute';
    hoverCanvas.style.top = '0';
    hoverCanvas.style.left = '0';
    hoverCanvas.style.pointerEvents = 'none';
    hoverCanvas.style.zIndex = '4';
    
    const hoverCtx = hoverCanvas.getContext('2d');
    hoverCtx.save(); 
    hoverCtx.strokeStyle = '#111827'; 
    hoverCtx.lineWidth = 2; 
    hoverCtx.globalAlpha = 0.6;
    hoverCtx.beginPath(); 
    hoverCtx.arc(n.x, n.y, nodeSize(n)+4, 0, Math.PI*2); 
    hoverCtx.stroke(); 
    hoverCtx.restore();
    
    // Remove any existing hover overlay
    const existingHover = canvas.parentNode.querySelector('.hover-overlay');
    if (existingHover) {
      existingHover.remove();
    }
    
    // Add the hover overlay
    hoverCanvas.className = 'hover-overlay';
    canvas.parentNode.appendChild(hoverCanvas);
  } else {
    hoveredNode = null;
    canvas.classList.remove('hovering');
    tooltipEl.style.display = 'none';
    drawNetwork();
  }
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  let clicked = null, minDist = Infinity;
  nodes.forEach(n => {
    const r = nodeSize(n);
    const d = Math.hypot(x - n.x, y - n.y);
    if (d < r && d < minDist) { clicked = n; minDist = d; }
  });

  if (clicked) {
    showNodeInfo(clicked);   // keep sidebar
    openNodeModal(clicked);  // new rich modal
  }
});

// Helper function to render a single post HTML
function renderPostHTML(p) {
  const a = p?.data?.author || {};
  const platform = p.platform || 'unknown';
  
  // Platform-specific URLs and icons
  let profileUrl, postUrl, platformIcon;
  if (platform === 'instagram') {
    profileUrl = a?.uniqueId ? `https://www.instagram.com/${a.uniqueId}` : null;
    // Construct Instagram URL from code (and optionally username)
    const postCode = p?.data?.code || p?.code || p?.data?.pk;
    const username = a?.uniqueId || p?.data?.user?.username;
    postUrl = postCode ? (username ? `https://www.instagram.com/${username}/p/${postCode}/` : `https://www.instagram.com/p/${postCode}/`) : null;
    platformIcon = '📷';
  } else if (platform === 'tiktok') {
    profileUrl = a?.uniqueId ? `https://www.tiktok.com/@${a.uniqueId}` : null;
    // Construct TikTok URL from username and video ID
    const username = a?.uniqueId;
    const videoId = p?.data?.id || p?.id;
    postUrl = (username && videoId) ? `https://www.tiktok.com/@${username}/video/${videoId}` : 
              (p?.tiktok_url || p?.data?.tiktok_url || p?.data?.webVideoUrl || p?.data?.shareUrl || null);
    platformIcon = '🎵';
  } else if (platform === 'twitter') {
    profileUrl = a?.uniqueId ? `https://x.com/${a.uniqueId}` : null;
    // Construct Twitter/X URL from username and tweet ID
    const username = a?.uniqueId;
    const tweetId = p?.data?.id || p?.id;
    postUrl = (username && tweetId) ? `https://x.com/${username}/status/${tweetId}` : null;
    platformIcon = '🐦';
  } else {
    profileUrl = null;
    postUrl = null;
    platformIcon = '❓';
  }
  
  const cap = (p?.data?.desc || '').slice(0, 220).replace(/</g,'<');
  const eng = postEngagement(p);
  const t = p?.data?.createTime ? new Date(p.data.createTime*1000).toLocaleString() : '';
  
  // Instagram-specific: location
  const location = p?.data?._instagram?.location;
  const locationText = location ? ` · 📍 ${location.name}` : '';
  
  const postLink = postUrl 
    ? `<a href="${postUrl}" target="_blank" rel="noopener" style="color:#059669; text-decoration:underline; font-weight:600;">🔗 view post</a>`
    : `<span style="color:#9ca3af; font-size:0.75rem;">no link available</span>`;
  
  return `<div style="padding:.6rem .6rem; border:1px solid #eee; border-radius:8px; margin:.45rem 0;">
    <div style="display:flex; justify-content:space-between; align-items:start; gap:0.5rem;">
      <div style="font-weight:600; flex:1;">${platformIcon} ${a.uniqueId ? '@'+a.uniqueId : '(unknown user)'}</div>
      <div style="flex-shrink:0;">${postLink}</div>
    </div>
    <div style="opacity:.95; margin-top:0.25rem;">${cap}${cap.length===220?'…':''}</div>
    <div style="opacity:.7; margin-top:.2rem">time: ${t} · engagement: ${eng.toLocaleString()}${locationText}</div>
  </div>`;
}

// State variable to track the original node for comparison mode
let comparisonState = null;

// Helper function to find a node by username
function findNodeByUsername(username) {
  // Try to find the node with various ID patterns
  const possibleIds = [username, `u_${username}`, `@${username}`];
  for (const id of possibleIds) {
    const node = idToNode.get(id);
    if (node) return node;
  }
  // If not found by ID, search by label
  for (const node of nodes) {
    if (node.label === username || node.label === `@${username}` || node.id === username) {
      return node;
    }
  }
  return null;
}

// Function to open comparison view
function openComparisonView(primaryNode, comparisonUsername) {
  const comparisonNode = findNodeByUsername(comparisonUsername);
  
  if (!comparisonNode) {
    alert(`Could not find user: ${comparisonUsername}`);
    return;
  }
  
  // Store state for back navigation
  comparisonState = {
    primaryNode: primaryNode,
    comparisonNode: comparisonNode
  };
  
  // Expand modal width for comparison view
  if (modalContentWrapper) {
    modalContentWrapper.style.width = 'min(1200px, 95vw)';
  }
  
  modalTitle.innerHTML = `Comparison: @${primaryNode.label} vs @${comparisonNode.label} <button id="back-to-single" style="background:#6b7280; color:white; border:none; padding:.4rem .8rem; border-radius:6px; cursor:pointer; font-size:0.875rem; margin-left:1rem;">← Back</button>`;
  
  // Get posts for both users
  const primaryPosts = samplePostsForNode(primaryNode, 10);
  const comparisonPosts = samplePostsForNode(comparisonNode, 10);
  
  const primaryPostsHTML = primaryPosts.map(p => renderPostHTML(p)).join('');
  const comparisonPostsHTML = comparisonPosts.map(p => renderPostHTML(p)).join('');
  
  // Create two-column layout
  modalBody.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1rem;">
      <!-- Primary user column -->
      <div style="border-right: 2px solid #e5e7eb; padding-right:1rem;">
        <h3 style="margin-bottom:0.5rem; color:#111827;">@${primaryNode.label}</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px; font-size:0.875rem;">
          <div><div class="small" style="color:#6b7280;">Type</div><div><b>${primaryNode.type}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Degree</div><div><b>${primaryNode.degree ?? 0}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Followers</div><div><b>${(primaryNode.followers||0).toLocaleString()}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Verified</div><div><b>${primaryNode.verified? 'Yes':'No'}</b></div></div>
        </div>
        ${primaryNode.suspicious ? `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:0.5rem; margin-bottom:0.5rem; font-size:0.75rem;">
          <div style="font-weight:700; color:#991b1b;">⚠️ CIB Risk: ${primaryNode.cibScore}/100</div>
        </div>
        ` : ''}
        <div style="margin-top:0.75rem; margin-bottom:0.5rem; font-weight:700;">Example posts (${primaryPosts.length})</div>
        <div style="max-height:400px; overflow-y:auto;">
          ${primaryPostsHTML || '<div class="small" style="color:#6b7280;">No posts found</div>'}
        </div>
      </div>
      
      <!-- Comparison user column -->
      <div style="padding-left:1rem;">
        <h3 style="margin-bottom:0.5rem; color:#111827;">@${comparisonNode.label}</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px; font-size:0.875rem;">
          <div><div class="small" style="color:#6b7280;">Type</div><div><b>${comparisonNode.type}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Degree</div><div><b>${comparisonNode.degree ?? 0}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Followers</div><div><b>${(comparisonNode.followers||0).toLocaleString()}</b></div></div>
          <div><div class="small" style="color:#6b7280;">Verified</div><div><b>${comparisonNode.verified? 'Yes':'No'}</b></div></div>
        </div>
        ${comparisonNode.suspicious ? `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:0.5rem; margin-bottom:0.5rem; font-size:0.75rem;">
          <div style="font-weight:700; color:#991b1b;">⚠️ CIB Risk: ${comparisonNode.cibScore}/100</div>
        </div>
        ` : ''}
        <div style="margin-top:0.75rem; margin-bottom:0.5rem; font-weight:700;">Example posts (${comparisonPosts.length})</div>
        <div style="max-height:400px; overflow-y:auto;">
          ${comparisonPostsHTML || '<div class="small" style="color:#6b7280;">No posts found</div>'}
        </div>
      </div>
    </div>
  `;
  
  // Add event listener for back button
  setTimeout(() => {
    const backBtn = document.getElementById('back-to-single');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (comparisonState && comparisonState.primaryNode) {
          openNodeModal(comparisonState.primaryNode);
          comparisonState = null;
        }
      });
    }
  }, 0);
}

function openNodeModal(node) {
  // Reset comparison state
  comparisonState = null;
  
  // Reset modal width to normal
  if (modalContentWrapper) {
    modalContentWrapper.style.width = 'min(780px, 92vw)';
  }
  
  let prefix = '';
  if (node.type === 'user') prefix = '@';
  else if (node.type === 'hashtag') prefix = '#';
  else if (node.type === 'location') prefix = '📍';
  modalTitle.textContent = `${prefix}${node.label || node.id}`;

  const nbs = Array.from(adjacency.get(node.id) || []);
  const neighborHTML = nbs.slice(0, 14).map(id => {
    const lab = idToNode.get(id)?.label || id;
    return `<code style="background:#f3f4f6; padding:.15rem .35rem; border-radius:6px; margin:.12rem; display:inline-block;">${lab}</code>`;
  }).join('');

  // Get all posts for hashtag and location nodes, sample for user nodes
  const posts = (node.type === 'hashtag' || node.type === 'location') ? getAllPostsForNode(node) : samplePostsForNode(node, 6);
  const postsHTML = posts.map(p => renderPostHTML(p)).join('');

  const teach = (() => {
    const deg = node.degree ?? 0;
    if (deg >= 12) return `This is a high-degree ${node.type}. Hubs can shape attention flows. Are neighbors from diverse communities, or mostly one echo chamber?`;
    if (deg <= 1)  return `This ${node.type} has very few connections. Is it peripheral, new, or filtered out by thresholds?`;
    return `Mid-degree ${node.type}. Check neighbors and example posts to see whether it bridges topics or audiences.`;
  })();

  const postsSectionTitle = (node.type === 'hashtag' || node.type === 'location')
    ? `All posts (${posts.length})` 
    : `Example posts (${posts.length})`;

  const postsContainerStyle = (node.type === 'hashtag' || node.type === 'location') 
    ? `max-height:300px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:8px; padding:.5rem; background:#fafafa;`
    : '';
  
  // Process CIB reasons to make account names clickable
  let cibReasonsHTML = '';
  if (node.suspicious && node.cibReasons) {
    cibReasonsHTML = node.cibReasons.map(reason => {
      // Check for patterns with multiple comma-separated usernames
      // Patterns: "Synchronized posting with:", "Rare hashtag combinations with:", "Similar username pattern with:"
      const multiUserPattern = /^((?:Synchronized posting|Rare hashtag combinations|Similar username pattern) with:\s*)(.+)$/;
      const multiUserMatch = reason.match(multiUserPattern);
      
      if (multiUserMatch && multiUserMatch[2]) {
        // Extract the list of usernames and handle "and X more" suffix
        let usernameText = multiUserMatch[2];
        let moreSuffix = '';
        
        // Check if there's an "and X more" suffix at the end
        const moreMatch = usernameText.match(/(.+?)\s+(and\s+\d+\s+more)$/);
        if (moreMatch) {
          usernameText = moreMatch[1];
          moreSuffix = moreMatch[2];
        }
        
        // Split usernames by comma and make each clickable
        const usernames = usernameText.split(',').map(u => u.trim()).filter(u => u.length > 0);
        const clickableUsernames = usernames.map(username => {
          return `<a href="#" class="comparison-link" data-username="${username}" style="color:#dc2626; text-decoration:underline; font-weight:600; cursor:pointer;">${username}</a>`;
        });
        
        // Join with commas and add the "and X more" suffix if present
        const clickableReason = multiUserMatch[1] + clickableUsernames.join(', ') + (moreSuffix ? ' ' + moreSuffix : '');
        return `<li style="margin:.15rem 0; color:#991b1b;">${clickableReason}</li>`;
      }
      
      // Check for "with" pattern (single username) - handles patterns like "Semantically similar captions... with username"
      const withPattern = /with\s+(@?)([a-zA-Z0-9_.-]+)/;
      const match = reason.match(withPattern);
      
      if (match && match[2]) {
        const username = match[2];
        // Make the username clickable
        const clickableReason = reason.replace(
          match[0],
          `with <a href="#" class="comparison-link" data-username="${username}" style="color:#dc2626; text-decoration:underline; font-weight:600; cursor:pointer;">${match[1]}${username}</a>`
        );
        return `<li style="margin:.15rem 0; color:#991b1b;">${clickableReason}</li>`;
      }
      
      return `<li style="margin:.15rem 0; color:#991b1b;">${reason}</li>`;
    }).join('');
  }

  modalBody.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:8px;">
      <div><div class="small" style="color:#6b7280;">Type</div><div><b>${node.type}</b></div></div>
      <div><div class="small" style="color:#6b7280;">Degree</div><div><b>${node.degree ?? 0}</b></div></div>
      ${node.type==='user'
        ? `<div><div class="small" style="color:#6b7280;">Followers</div><div><b>${(node.followers||0).toLocaleString()}</b></div></div>
           <div><div class="small" style="color:#6b7280;">Verified</div><div><b>${node.verified? 'Yes':'No'}</b></div></div>`
        : node.type==='location'
        ? `<div><div class="small" style="color:#6b7280;">Posts at location</div><div><b>${node.count||0}</b></div></div>
           <div><div class="small" style="color:#6b7280;">Coordinates</div><div><b>${node.lat?.toFixed(4) || '?'}, ${node.lng?.toFixed(4) || '?'}</b></div></div>`
        : `<div><div class="small" style="color:#6b7280;">Usage count</div><div><b>${node.count||0}</b></div></div><div></div>`}
    </div>

    ${node.suspicious ? `
    <div class="warning-box" style="margin:.5rem 0;">
      <div style="font-weight:700; color:#991b1b; margin-bottom:.4rem;">⚠️ CIB DETECTED (Risk Score: ${node.cibScore}/100)</div>
      <div style="font-size:0.75rem; color:#7f1d1d; margin-bottom:.3rem;"><b>Indicators triggered:</b></div>
      <ul style="margin:0; padding-left:1.2rem; list-style:disc;">
        ${cibReasonsHTML}
      </ul>
      <p style="margin-top:.4rem;"><strong>Note:</strong> These are behavioral indicators. Verify with manual inspection before drawing conclusions.</p>
    </div>
    ` : ''}

    <div class="small" style="background:#fff7ed; border:1px solid #fde7c7; padding:.6rem .7rem; border-radius:8px; margin:.4rem 0;">
      <b>Why it matters:</b> ${teach}
    </div>

    <div style="margin:.6rem 0 .25rem; font-weight:700;">Neighbors (${nbs.length})</div>
    <div>${neighborHTML || '<span class="small" style="color:#6b7280;">No neighbors</span>'}</div>

    <div style="margin:.9rem 0 .35rem; font-weight:700;">${postsSectionTitle}</div>
    <div style="${postsContainerStyle}" id="posts-container">
      ${postsHTML || '<div class="small" style="color:#6b7280;">No posts found for this node given current filters.</div>'}
    </div>
    ${(node.type === 'hashtag' || node.type === 'location') && posts.length > 0 ? 
      `<div class="small" style="color:#6b7280; margin-top:.25rem; text-align:center;">Scroll to see all ${posts.length} posts</div>` : ''}
  `;
  
  // Add event listeners for comparison links
  setTimeout(() => {
    const comparisonLinks = modalBody.querySelectorAll('.comparison-link');
    comparisonLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const username = link.getAttribute('data-username');
        openComparisonView(node, username);
      });
    });
  }, 0);
  
  modalEl.style.display = 'flex';
}
modalClose.addEventListener('click', ()=> modalEl.style.display = 'none');
modalEl.addEventListener('click', (e)=> { if (e.target === modalEl) modalEl.style.display = 'none'; });

function showNodeInfo(node) {
  let html = `<div class="info-row"><span class="info-label">Label:</span> <span class="info-value">${node.label}</span></div>`;
  html += `<div class="info-row"><span class="info-label">Type:</span> <span class="info-value">${node.type}</span></div>`;
  if (node.degree !== undefined) html += `<div class="info-row"><span class="info-label">Degree:</span> <span class="info-value">${node.degree}</span></div>`;
  if (node.followers !== undefined) html += `<div class="info-row"><span class="info-label">Followers:</span> <span class="info-value">${(node.followers||0).toLocaleString()}</span></div>`;
  if (node.count !== undefined) html += `<div class="info-row"><span class="info-label">Usage:</span> <span class="info-value">${node.count} posts</span></div>`;
  if (node.suspicious) {
    html += `<div class="info-row"><span class="cib-indicator">⚠ SUSPICIOUS ACTIVITY</span></div>`;
    if (node.cibScore) html += `<div class="info-row"><span class="info-label">CIB Score:</span> <span class="cib-score">${node.cibScore}/100</span></div>`;
  }
  if (communities && communities.communities.has(node.id)) {
    const cid = communities.communities.get(node.id);
    html += `<div class="info-row"><span class="info-label">Community:</span> <span class="info-value">#${cid + 1}</span></div>`;
  }
  if (node.verified) html += `<div class="info-row" style="color:#2563eb; font-weight: 600;">✓ Verified</div>`;
  nodeDetails.innerHTML = html;
  nodeInfo.style.display = 'block';
}
closeInfo.addEventListener('click', ()=> { nodeInfo.style.display = 'none'; });

// =========================
// Communities button
// =========================
cibBtn.addEventListener('click', detectCIB);

// CIB Advanced Settings handlers
cibSettingsBtn.addEventListener('click', () => {
  const isOpening = cibSettingsPanel.style.display === 'none';
  cibSettingsPanel.style.display = isOpening ? 'block' : 'none';
  
  // Initialize parameters with current sensitivity preset when opening
  if (isOpening) {
    const currentThreshold = parseInt(cibThreshold.value, 10);
    applySensitivityPreset(currentThreshold);
  }
});

closeCibSettings.addEventListener('click', () => {
  cibSettingsPanel.style.display = 'none';
});

resetCibParamsBtn.addEventListener('click', () => {
  resetCibParams();
  const currentLevel = thresholdLabels[cibThreshold.value];
  alert(`CIB parameters reset to ${currentLevel} sensitivity preset`);
});

detectBtn.addEventListener('click', () => {
  if (!graphData || graphData.nodes.length === 0) return;
  loading.classList.add('active');
  loadingText.textContent = 'Detecting communities...';
  setTimeout(() => {
    communities = detectCommunities(graphData);
    if (communities && statElements.communities) statElements.communities.textContent = communities.count;
    drawNetwork();
    loading.classList.remove('active');
    updateCoach();
  }, 100);
});

// =========================
// Controls wiring
// =========================
networkTypeSelect.addEventListener('change', updateNetwork);
nodeSizeBySelect.addEventListener('change', () => {
  if (nodes.length > 0) drawNetwork();
});
engagementFilter.addEventListener('input', (e) => {
  const value = e.target.value; engagementValue.textContent = `${value}+ interactions`;
  updateNetwork();
});
dateStart.addEventListener('change', updateNetwork);
dateEnd.addEventListener('change', updateNetwork);

exportBtn.addEventListener('click', () => {
  if (!graphData) return;
  const exportData = {
    ...graphData,
    metrics: networkMetrics,
    communities: communities ? { count: communities.count, assignments: Array.from(communities.communities.entries()) } : null,
    cibDetection: cibDetection ? {
      suspiciousUsers: Array.from(cibDetection.suspiciousUsers),
      indicators: cibDetection.indicators,
      userScores: Array.from(cibDetection.userScores.entries()),
      userReasons: Array.from(cibDetection.userReasons.entries())
    } : null
  };
  const dataStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `network_analysis_${Date.now()}.json`; link.click();
  URL.revokeObjectURL(url);
});

// Export CIB Detection Results as CSV
exportCsvBtn.addEventListener('click', () => {
  if (!cibDetection || !cibDetection.suspiciousUsers || cibDetection.suspiciousUsers.size === 0) {
    alert('No CIB detection results available. Please run "Detect Coordinated Behavior" first.');
    return;
  }

  const rows = [];
  // CSV Header
  rows.push([
    'User ID',
    'Username',
    'Risk Score',
    'Risk Level',
    'Indicators Count',
    'Indicators Triggered',
    'Follower Count',
    'Verified',
    'Post Count',
    'Avg Engagement',
    'Detailed Reasons'
  ]);

  // Collect data for each suspicious user
  cibDetection.suspiciousUsers.forEach(userId => {
    const score = cibDetection.userScores.get(userId) || 0;
    const reasons = cibDetection.userReasons.get(userId) || [];
    
    // Determine risk level
    let riskLevel = 'Low';
    if (score >= 86) riskLevel = 'Critical';
    else if (score >= 61) riskLevel = 'High';
    else if (score >= 31) riskLevel = 'Medium';
    
    // Find user data from posts
    const userPosts = filteredData.filter(post => post.data?.author?.id === userId);
    const userData = userPosts[0]?.data?.author || {};
    const authorStats = userPosts[0]?.data?.authorStats || {};
    
    const username = userData.uniqueId || userData.nickname || userId;
    const followers = authorStats.followerCount || 0;
    const verified = userData.verified ? 'Yes' : 'No';
    const postCount = userPosts.length;
    
    // Calculate average engagement
    let totalEngagement = 0;
    userPosts.forEach(post => {
      const stats = post.data?.stats || {};
      totalEngagement += (stats.diggCount || 0) + (stats.commentCount || 0) + (stats.shareCount || 0);
    });
    const avgEngagement = postCount > 0 ? Math.round(totalEngagement / postCount) : 0;
    
    // Extract indicator types
    const indicatorTypes = new Set();
    reasons.forEach(reason => {
      if (reason.includes('synchronized')) indicatorTypes.add('synchronized_posting');
      if (reason.includes('hashtag')) indicatorTypes.add('rare_hashtags');
      if (reason.includes('username')) indicatorTypes.add('similar_username');
      if (reason.includes('high volume') || reason.includes('volume')) indicatorTypes.add('high_volume');
      if (reason.includes('burst')) indicatorTypes.add('temporal_burst');
      if (reason.includes('regular posting')) indicatorTypes.add('posting_rhythm');
      if (reason.includes('24/7') || reason.includes('night')) indicatorTypes.add('24_7_activity');
      if (reason.includes('semantic') || reason.includes('similar captions')) indicatorTypes.add('semantic_similarity');
      if (reason.includes('template')) indicatorTypes.add('caption_template');
      if (reason.includes('created with') || reason.includes('account creation')) indicatorTypes.add('account_clustering');
    });
    
    rows.push([
      userId,
      username,
      score,
      riskLevel,
      reasons.length,
      Array.from(indicatorTypes).join('; '),
      followers,
      verified,
      postCount,
      avgEngagement,
      reasons.join('; ')
    ]);
  });

  // Convert to CSV format
  const csvContent = rows.map(row => 
    row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma, newline, or quote
      const cellStr = String(cell);
      if (cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')) {
        return '"' + cellStr.replace(/"/g, '""') + '"';
      }
      return cellStr;
    }).join(',')
  ).join('\n');

  // Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cib_suspicious_accounts_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

// Export Investigation Report as HTML
exportReportBtn.addEventListener('click', () => {
  if (!cibDetection || !cibDetection.suspiciousUsers || cibDetection.suspiciousUsers.size === 0) {
    alert('No CIB detection results available. Please run "Detect Coordinated Behavior" first.');
    return;
  }

  const timestamp = new Date().toLocaleString();
  const params = getCibParams();
  
  // Calculate statistics
  const totalSuspicious = cibDetection.suspiciousUsers.size;
  const scores = Array.from(cibDetection.userScores.values());
  const critical = scores.filter(s => s >= 86).length;
  const high = scores.filter(s => s >= 61 && s < 86).length;
  const medium = scores.filter(s => s >= 31 && s < 61).length;
  const low = scores.filter(s => s < 31).length;
  
  // Get dataset info
  const totalPosts = filteredData.length;
  const uniqueUsers = new Set(filteredData.map(p => p.data?.author?.id).filter(Boolean)).size;
  const timestamps = filteredData.map(p => p.data?.createTime).filter(Boolean);
  const minDate = timestamps.length > 0 ? new Date(Math.min(...timestamps) * 1000).toLocaleDateString() : 'N/A';
  const maxDate = timestamps.length > 0 ? new Date(Math.max(...timestamps) * 1000).toLocaleDateString() : 'N/A';
  
  // Get platform indicator
  const platformText = document.getElementById('platform-indicator')?.textContent || 'Unknown';
  
  // Collect top offenders
  const topOffenders = Array.from(cibDetection.suspiciousUsers)
    .map(userId => ({
      userId,
      score: cibDetection.userScores.get(userId) || 0,
      reasons: cibDetection.userReasons.get(userId) || [],
      userData: filteredData.find(p => p.data?.author?.id === userId)?.data?.author || {}
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // Top 20
  
  // Build HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CIB Investigation Report - ${timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #f9fafb;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { border-bottom: 3px solid #dc2626; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    h1 { color: #dc2626; font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #6b7280; font-size: 0.875rem; }
    .section { margin: 2rem 0; }
    h2 { color: #111827; font-size: 1.5rem; margin-bottom: 1rem; border-left: 4px solid #dc2626; padding-left: 1rem; }
    h3 { color: #374151; font-size: 1.25rem; margin: 1.5rem 0 1rem; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .stat-box { background: #f3f4f6; padding: 1.25rem; border-radius: 8px; text-align: center; }
    .stat-box.critical { background: #fee2e2; border: 2px solid #dc2626; }
    .stat-box.high { background: #fed7aa; border: 2px solid #ea580c; }
    .stat-box.medium { background: #fef3c7; border: 2px solid #d97706; }
    .stat-label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #111827; margin-top: 0.25rem; }
    .indicator-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .indicator-box { background: #f9fafb; border: 1px solid #e5e7eb; padding: 1rem; border-radius: 8px; }
    .indicator-box strong { display: block; color: #111827; margin-bottom: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
    th { background: #111827; color: white; padding: 0.75rem; text-align: left; font-weight: 600; }
    td { padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
    tr:hover { background: #f9fafb; }
    .risk-badge { 
      display: inline-block; 
      padding: 0.25rem 0.75rem; 
      border-radius: 9999px; 
      font-size: 0.75rem; 
      font-weight: 600;
      text-transform: uppercase;
    }
    .risk-critical { background: #fee2e2; color: #991b1b; }
    .risk-high { background: #fed7aa; color: #9a3412; }
    .risk-medium { background: #fef3c7; color: #92400e; }
    .risk-low { background: #dbeafe; color: #1e40af; }
    .warning-box { background: #fef3c7; border: 2px solid #f59e0b; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    .warning-box strong { color: #92400e; }
    .footer { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 0.875rem; }
    .key-findings { background: #fee2e2; border-left: 4px solid #dc2626; padding: 1rem; margin: 1rem 0; }
    .key-findings ul { margin-left: 1.5rem; margin-top: 0.5rem; }
    .key-findings li { margin: 0.5rem 0; color: #7f1d1d; }
    ul.reasons { list-style: disc; margin-left: 1.5rem; font-size: 0.875rem; color: #4b5563; }
    ul.reasons li { margin: 0.25rem 0; }
    .params-box { background: #f3f4f6; padding: 1rem; border-radius: 8px; font-size: 0.875rem; }
    .params-box code { background: #e5e7eb; padding: 0.125rem 0.375rem; border-radius: 4px; }
    @media print { body { background: white; padding: 0; } .container { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ Coordinated Inauthentic Behavior Investigation Report</h1>
      <div class="subtitle">Generated: ${timestamp} | Tool: SchuimSurfer | Platform: ${platformText}</div>
    </div>

    <div class="section">
      <h2>Executive Summary</h2>
      <div class="summary-grid">
        <div class="stat-box">
          <div class="stat-label">Total Posts Analyzed</div>
          <div class="stat-value">${totalPosts.toLocaleString()}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Unique Users</div>
          <div class="stat-value">${uniqueUsers.toLocaleString()}</div>
        </div>
        <div class="stat-box critical">
          <div class="stat-label">Suspicious Accounts</div>
          <div class="stat-value">${totalSuspicious}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Suspicion Rate</div>
          <div class="stat-value">${((totalSuspicious / uniqueUsers) * 100).toFixed(1)}%</div>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-box critical">
          <div class="stat-label">Critical Risk (86-100)</div>
          <div class="stat-value">${critical}</div>
        </div>
        <div class="stat-box high">
          <div class="stat-label">High Risk (61-85)</div>
          <div class="stat-value">${high}</div>
        </div>
        <div class="stat-box medium">
          <div class="stat-label">Medium Risk (31-60)</div>
          <div class="stat-value">${medium}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Low Risk (0-30)</div>
          <div class="stat-value">${low}</div>
        </div>
      </div>

      <p><strong>Data Range:</strong> ${minDate} to ${maxDate}</p>
      <p><strong>CIB Sensitivity Level:</strong> ${document.getElementById('threshold-value')?.textContent || 'N/A'}</p>
    </div>

    <div class="section">
      <h2>Key Findings</h2>
      <div class="key-findings">
        <strong style="color: #991b1b;">⚠️ Primary Concerns:</strong>
        <ul>
          ${critical > 0 ? `<li><strong>${critical} accounts</strong> flagged as <strong>CRITICAL RISK</strong> - Multiple indicators suggest coordinated inauthentic behavior</li>` : ''}
          ${high > 0 ? `<li><strong>${high} accounts</strong> flagged as <strong>HIGH RISK</strong> - Strong evidence of coordination</li>` : ''}
          ${cibDetection.indicators.synchronized > 0 ? `<li><strong>Synchronized posting detected:</strong> ${cibDetection.indicators.synchronized} account pairs posting within narrow time windows</li>` : ''}
          ${cibDetection.indicators.identicalHashtags > 0 ? `<li><strong>Coordinated hashtag usage:</strong> ${cibDetection.indicators.identicalHashtags} users sharing rare hashtag combinations</li>` : ''}
          ${cibDetection.indicators.similarUsernames > 0 ? `<li><strong>Username pattern matching:</strong> ${cibDetection.indicators.similarUsernames} users with similar account names</li>` : ''}
          ${cibDetection.indicators.accountCreationClusters > 0 ? `<li><strong>Bot farm indicators:</strong> ${cibDetection.indicators.accountCreationClusters} clusters of accounts created simultaneously</li>` : ''}
          ${cibDetection.indicators.semanticDuplicates > 0 ? `<li><strong>AI-detected coordination:</strong> ${cibDetection.indicators.semanticDuplicates} pairs of semantically similar captions</li>` : ''}
        </ul>
      </div>
    </div>

    <div class="section">
      <h2>Detection Indicators Summary</h2>
      <div class="indicator-grid">
        <div class="indicator-box">
          <strong>⏱️ Synchronized Posting</strong>
          ${cibDetection.indicators.synchronized || 0} account pairs detected
        </div>
        <div class="indicator-box">
          <strong>🏷️ Rare Hashtag Combos</strong>
          ${cibDetection.indicators.identicalHashtags || 0} users flagged
        </div>
        <div class="indicator-box">
          <strong>👤 Similar Usernames</strong>
          ${cibDetection.indicators.similarUsernames || 0} users flagged
        </div>
        <div class="indicator-box">
          <strong>📈 High Volume Posting</strong>
          ${cibDetection.indicators.highVolume || 0} users flagged
        </div>
        ${cibDetection.indicators.semanticDuplicates ? `
        <div class="indicator-box">
          <strong>🤖 Semantic Duplicates (AI)</strong>
          ${cibDetection.indicators.semanticDuplicates} pairs detected
        </div>` : ''}
        ${cibDetection.indicators.temporalBursts ? `
        <div class="indicator-box">
          <strong>💥 Temporal Bursts</strong>
          ${cibDetection.indicators.temporalBursts} users flagged
        </div>` : ''}
        ${cibDetection.indicators.templateCaptions ? `
        <div class="indicator-box">
          <strong>📝 Template Captions</strong>
          ${cibDetection.indicators.templateCaptions} pairs detected
        </div>` : ''}
        ${cibDetection.indicators.accountCreationClusters ? `
        <div class="indicator-box">
          <strong>🏭 Account Creation Clusters</strong>
          ${cibDetection.indicators.accountCreationClusters} clusters detected
        </div>` : ''}
      </div>
    </div>

    <div class="section">
      <h2>Top ${Math.min(20, topOffenders.length)} Suspicious Accounts</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Username</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
            <th>Indicators</th>
            <th>Key Reasons</th>
          </tr>
        </thead>
        <tbody>
          ${topOffenders.map((offender, idx) => {
            const riskClass = offender.score >= 86 ? 'risk-critical' : 
                             offender.score >= 61 ? 'risk-high' : 
                             offender.score >= 31 ? 'risk-medium' : 'risk-low';
            const riskLevel = offender.score >= 86 ? 'Critical' : 
                             offender.score >= 61 ? 'High' : 
                             offender.score >= 31 ? 'Medium' : 'Low';
            return `
            <tr>
              <td><strong>${idx + 1}</strong></td>
              <td>${offender.userData.uniqueId || offender.userData.nickname || offender.userId}</td>
              <td><strong>${offender.score}</strong>/100</td>
              <td><span class="risk-badge ${riskClass}">${riskLevel}</span></td>
              <td>${offender.reasons.length}</td>
              <td style="max-width: 400px;">
                <ul class="reasons">
                  ${offender.reasons.slice(0, 3).map(r => `<li>${r}</li>`).join('')}
                  ${offender.reasons.length > 3 ? `<li><em>+${offender.reasons.length - 3} more...</em></li>` : ''}
                </ul>
              </td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Detection Parameters Used</h2>
      <div class="params-box">
        <p><strong>Configuration:</strong></p>
        <ul style="margin-left: 1.5rem; margin-top: 0.5rem;">
          <li>Semantic Similarity: ${params.semanticEnabled ? `Enabled (threshold: ${params.semanticThreshold})` : 'Disabled'}</li>
          <li>Time Window: ${document.getElementById('time-window-value')?.textContent || 'N/A'}</li>
          <li>N-gram Overlap: ${params.ngramThreshold}</li>
          <li>Username Similarity: ${params.usernameThreshold}</li>
          <li>TF-IDF Threshold: ${params.tfidfThreshold}</li>
          <li>Z-Score Threshold: ${params.zscoreThreshold}</li>
          <li>Burst Min Posts: ${params.burstPosts}</li>
          <li>Rhythm CV Threshold: ${params.rhythmCV}</li>
          <li>Night Gap: ${params.nightGap}s</li>
          <li>Cluster Min Size: ${params.clusterSize}</li>
          <li>Cross-Indicator Bonus: ${params.crossMultiplier}</li>
        </ul>
      </div>
    </div>

    <div class="section">
      <div class="warning-box">
        <strong>⚠️ Important Disclaimer:</strong>
        <p style="margin-top: 0.5rem;">
          This report presents <strong>behavioral indicators</strong>, not definitive proof of inauthentic activity. 
          Legitimate activism, coordinated campaigns, fan communities, and event promotion can trigger these signals. 
          <strong>Always verify findings manually</strong> and consider contextual factors before drawing conclusions.
          Multiple indicators increase confidence, but human judgment is essential for accurate assessment.
        </p>
      </div>
    </div>

    <div class="section">
      <h2>Recommended Actions</h2>
      <ol style="margin-left: 2rem; line-height: 2;">
        <li><strong>Manual Review:</strong> Investigate the top ${Math.min(10, critical + high)} high-risk accounts in detail</li>
        <li><strong>Content Analysis:</strong> Examine post content for narrative themes and coordination patterns</li>
        <li><strong>Temporal Analysis:</strong> Review activity timelines for unusual patterns</li>
        <li><strong>Network Analysis:</strong> Examine connections between flagged accounts</li>
        <li><strong>Context Research:</strong> Investigate surrounding events that may explain coordinated activity</li>
        <li><strong>Cross-Platform Check:</strong> Look for similar patterns on other social media platforms</li>
        <li><strong>Documentation:</strong> Preserve evidence (screenshots, URLs, timestamps) for further investigation</li>
      </ol>
    </div>

    <div class="footer">
      <p><strong>Generated by SchuimSurfer</strong> - Social Media Network Analysis & CIB Detection Tool</p>
      <p>Report generated: ${timestamp}</p>
      <p style="margin-top: 1rem; font-size: 0.75rem; color: #9ca3af;">
        This is an automated analysis report. All findings should be verified by qualified investigators.
      </p>
    </div>
  </div>
</body>
</html>`;

  // Download
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cib_investigation_report_${Date.now()}.html`;
  link.click();
  URL.revokeObjectURL(url);
});

searchInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  if (!term || !nodes.length) { drawNetwork(); return; }
  drawNetwork();
  const matches = nodes.filter(n => (n.label || '').toLowerCase().includes(term));
  
  // Draw search highlights using overlay canvas to avoid context conflicts
  const highlightCanvas = document.createElement('canvas');
  highlightCanvas.width = canvas.width;
  highlightCanvas.height = canvas.height;
  highlightCanvas.style.position = 'absolute';
  highlightCanvas.style.top = '0';
  highlightCanvas.style.left = '0';
  highlightCanvas.style.pointerEvents = 'none';
  highlightCanvas.style.zIndex = '3';
  
  const highlightCtx = highlightCanvas.getContext('2d');
  highlightCtx.strokeStyle = '#ef4444'; 
  highlightCtx.lineWidth = 3;
  matches.forEach(n => { 
    const r = nodeSize(n); 
    highlightCtx.beginPath(); 
    highlightCtx.arc(n.x, n.y, r+3, 0, Math.PI*2); 
    highlightCtx.stroke(); 
  });
  
  // Remove any existing search highlight overlay
  const existingSearchHighlight = canvas.parentNode.querySelector('.search-highlight-overlay');
  if (existingSearchHighlight) {
    existingSearchHighlight.remove();
  }
  
  // Add the search highlight overlay
  highlightCanvas.className = 'search-highlight-overlay';
  canvas.parentNode.appendChild(highlightCanvas);
});

window.addEventListener('resize', () => {
  if (graphData && graphData.nodes.length > 0) initializeVisualization();
});

// =========================
// Teaching coach (dynamic)
// =========================
function updateCoach() {
  const coach = document.getElementById('edu-coach');
  if (!graphData || !graphData.nodes.length) {
    coach.innerHTML = `<p><b>Guillen</b> load data, then hover or click nodes.</p>`;
    return;
  }
  const dens = networkMetrics?.density ?? 0;
  const commCount = communities?.count ?? 0;

  let hint = '';
  const networkType = networkTypeSelect.value;
  if (networkType === 'coHashtag') {
    hint = `You're looking at hashtag co-occurrence. Dense cliques can reflect coordinated messaging or just memes — check example posts in the modal.`;
  } else if (networkType === 'userHashtag') {
    hint = `This is a bipartite user↔hashtag graph. Click a hashtag hub: who uses it? One community or many?`;
  } else if (networkType === 'mention') {
    hint = `Mention networks highlight attention-giving. Are hubs amplifying each other, or bridging clusters?`;
  } else if (networkType === 'photoTag') {
    hint = `📷 Instagram photo tag network: see who tags whom in photos. This reveals collaboration and relationship patterns.`;
  } else if (networkType === 'location') {
    hint = `📍 Instagram location network: where are users posting from? Shared locations can indicate coordinated campaigns or events.`;
  } else {
    hint = `Hashtag usage view shows which tags carry engagement; hubs suggest narrative anchors.`;
  }

  const densNote = (parseFloat(dens) >= 0.15)
    ? `High density (${dens}) ⇒ tight interlinking. Inspect hubs for templated captions or synchronized timing.`
    : `Lower density (${dens}) ⇒ fragmented/diverse activity. Look for bridges and outliers.`;

  const commNote = commCount
    ? `Detected <b>${commCount}</b> community${commCount>1?'ies':''}. Compare top tags/posts across them for narrative splits.`
    : `Run “Detect Communities” to see sub-audiences.`;

  coach.innerHTML = `
    <p><b>Guillen:</b> ${hint}</p>
    <p>${densNote}</p>
    <p>${commNote}</p>
  `;
}
// Help Modal functionality
const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');
const helpBody = document.getElementById('help-body');

// Simple markdown to HTML converter (basic features)
function markdownToHtml(md) {
  let html = md;
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic  
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Code inline
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>');
  
  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');
  
  // Lists (basic)
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li>$2</li>');
  
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, function(match) {
    return '<ul>' + match + '</ul>';
  });
  
  // Paragraphs
  html = html.split('\n\n').map(para => {
    para = para.trim();
    if (!para) return '';
    if (para.startsWith('<h') || para.startsWith('<ul') || para.startsWith('<hr') || para.startsWith('<pre')) {
      return para;
    }
    return '<p>' + para + '</p>';
  }).join('\n');
  
  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  
  return html;
}

// Load README content
async function loadReadme() {
  try {
    const response = await fetch('README.md');
    const markdown = await response.text();
    const html = markdownToHtml(markdown);
    helpBody.innerHTML = html;
  } catch (error) {
    console.error('Failed to load README:', error);
    helpBody.innerHTML = `
      <h1>SchuimSurfer User Guide</h1>
      <p><strong>Unable to load README.md file.</strong> Please ensure README.md is in the same directory as this HTML file.</p>
      <h2>Quick Start</h2>
      <p>1. Upload your social media data (JSON format)<br>
      2. Select network type from dropdown<br>
      3. Click "Detect Communities" to identify clusters<br>
      4. Click "Detect Coordinated Behavior" to run CIB analysis<br>
      5. Click nodes to see details</p>
      <h2>CIB Detection Methods</h2>
      <ul>
        <li>🤖 <strong>Semantic Similarity</strong> - AI-powered caption matching</li>
        <li>⏱️ <strong>Synchronized Posting</strong> - Coordinated timing detection</li>
        <li>🏷️ <strong>TF-IDF Hashtags</strong> - Rare hashtag combinations</li>
        <li>👤 <strong>Username Patterns</strong> - Similar account names</li>
        <li>📈 <strong>Z-Score Analysis</strong> - Statistical outlier detection</li>
        <li>💥 <strong>Temporal Bursts</strong> - Activity spikes</li>
        <li>🎵 <strong>Posting Rhythm</strong> - Bot-like regularity</li>
        <li>🌙 <strong>24/7 Activity</strong> - No sleep gaps</li>
        <li>📝 <strong>N-gram Templates</strong> - Caption templates</li>
        <li>🏭 <strong>Account Clustering</strong> - Batch creation detection</li>
      </ul>
      <h2>Advanced Settings</h2>
      <p>Click "Advanced CIB Settings" to fine-tune detection parameters:</p>
      <ul>
        <li><strong>Semantic Similarity</strong> (0.85) - AI caption threshold</li>
        <li><strong>N-gram Overlap</strong> (0.3) - Template detection</li>
        <li><strong>Username Similarity</strong> (0.8) - Name matching</li>
        <li><strong>TF-IDF Threshold</strong> (0.5) - Rare hashtag sensitivity</li>
        <li><strong>Z-Score Threshold</strong> (2) - Volume outliers</li>
        <li><strong>Burst Min Posts</strong> (5) - Burst trigger</li>
        <li><strong>Rhythm CV</strong> (0.1) - Regularity threshold</li>
        <li><strong>Night Gap</strong> (7200s) - 24/7 detection</li>
        <li><strong>Cluster Size</strong> (5) - Account creation groups</li>
        <li><strong>Cross-Indicator Bonus</strong> (0.3) - Score multiplier</li>
      </ul>
      <h2>Important Notes</h2>
      <p><strong>⚠️ These are indicators, not proof.</strong> Always verify findings manually and consider context.</p>
      <p><strong>Privacy:</strong> All processing happens in your browser. No data is sent to servers.</p>
      <p><strong>Legitimate Coordination:</strong> Activist campaigns, fan communities, and event promotions may trigger detection. Context matters!</p>
    `;
  }
}

// Open modal
helpBtn.addEventListener('click', () => {
  helpModal.classList.add('active');
  if (helpBody.innerHTML.includes('Loading guide')) {
    loadReadme();
  }
});

// Close modal
helpClose.addEventListener('click', () => {
  helpModal.classList.remove('active');
});

// Close on overlay click
helpModal.addEventListener('click', () => {
  helpModal.classList.remove('active');
});

// Prevent closing when clicking content
document.querySelector('.help-content').addEventListener('click', (e) => {
  e.stopPropagation();
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && helpModal.classList.contains('active')) {
    helpModal.classList.remove('active');
  }
});

// =========================
// Initialize CIB parameters with default sensitivity preset
// =========================
// Set initial parameters based on the default threshold value (5 = Medium)
applySensitivityPreset(parseInt(cibThreshold.value, 10));
