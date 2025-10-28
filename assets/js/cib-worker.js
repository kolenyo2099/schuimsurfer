// Web Worker for CIB Detection
// This offloads heavy computation from the main thread to keep UI responsive

// Note: We'll dynamically import Transformers.js when needed (for semantic similarity)

// Analytics functions (copied from analytics.js for worker context)
function calculateDatasetStatistics(filteredData) {
  const postCounts = new Map();
  const hashtagCounts = new Map();

  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    if (!userId) return;

    postCounts.set(userId, (postCounts.get(userId) || 0) + 1);

    const hashtags = post.data?.challenges?.length || 0;
    hashtagCounts.set(userId, (hashtagCounts.get(userId) || 0) + hashtags);
  });

  const posts = Array.from(postCounts.values());
  const hashtags = Array.from(hashtagCounts.values());

  const postsMean = posts.reduce((a, b) => a + b, 0) / (posts.length || 1);
  const hashtagsMean = hashtags.reduce((a, b) => a + b, 0) / (hashtags.length || 1);

  return {
    posts: {
      mean: postsMean,
      stdDev: Math.sqrt(posts.reduce((sq, n) => sq + Math.pow(n - postsMean, 2), 0) / (posts.length || 1)),
    },
    hashtags: {
      mean: hashtagsMean,
      stdDev: Math.sqrt(hashtags.reduce((sq, n) => sq + Math.pow(n - hashtagsMean, 2), 0) / (hashtags.length || 1)),
    },
  };
}

function calculateTFIDF(hashtag, userHashtags, allHashtags) {
  let count = 0;
  for (let i = 0; i < userHashtags.length; i++) {
    if (userHashtags[i] === hashtag) count++;
  }
  const tf = userHashtags.length ? count / userHashtags.length : 0;

  let usersWithHashtag = 0;
  for (let i = 0; i < allHashtags.length; i++) {
    if (allHashtags[i].has(hashtag)) usersWithHashtag++;
  }
  const idf = Math.log(allHashtags.length / (usersWithHashtag + 1));

  return tf * idf;
}

function getNGrams(text, n = 5) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const ngrams = [];

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function ngramOverlap(textA, textB, n = 5) {
  const ngramsA = getNGrams(textA, n);
  const ngramsB = getNGrams(textB, n);
  if (ngramsA.length === 0 || ngramsB.length === 0) return 0;

  const setA = new Set(ngramsA);
  const setB = new Set(ngramsB);
  let overlap = 0;
  setA.forEach(ngram => {
    if (setB.has(ngram)) overlap++;
  });
  return overlap / Math.max(setA.size, setB.size);
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  matrix[0] = Array.from({ length: a.length + 1 }, (_, j) => j);

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function analyzePostingRhythm(posts, cvThreshold = 0.1) {
  if (posts.length < 5) return { regular: false, stdDev: null };

  const timestamps = posts.map(p => p.timestamp).sort();
  const intervals = [];

  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - mean, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  return {
    regular: coefficientOfVariation < cvThreshold,
    stdDev,
    mean,
    cv: coefficientOfVariation,
  };
}

function analyzeNightPosting(posts, gapThreshold = 7200) {
  if (posts.length < 10) return { suspicious: false };

  const timestamps = posts.map(p => p.timestamp).sort();
  const dailyGaps = new Map();

  timestamps.forEach(ts => {
    const date = new Date(ts * 1000);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    if (!dailyGaps.has(dayKey)) dailyGaps.set(dayKey, []);
    dailyGaps.get(dayKey).push(date.getHours() * 3600 + date.getMinutes() * 60);
  });

  const avgMaxGap = Array.from(dailyGaps.values()).map(day => {
    day.sort((a, b) => a - b);
    let maxGap = 0;

    for (let i = 1; i < day.length; i++) {
      maxGap = Math.max(maxGap, day[i] - day[i - 1]);
    }

    if (day.length > 1) {
      maxGap = Math.max(maxGap, 86400 - day[day.length - 1] + day[0]);
    }

    return maxGap;
  }).reduce((a, b) => a + b, 0) / (dailyGaps.size || 1);

  return {
    suspicious: avgMaxGap < gapThreshold,
    avgMaxGap,
  };
}

function detectAccountCreationClusters(posts, timeWindow = 86400, minClusterSize = 5) {
  const accountCreationTimes = new Map();
  const uniqueAccounts = new Set();

  posts.forEach(post => {
    const author = post.data?.author;
    if (!author?.id) return;

    uniqueAccounts.add(author.id);

    const creationTime = author.createTime;
    if (!creationTime) return;

    if (!accountCreationTimes.has(author.id)) {
      accountCreationTimes.set(author.id, creationTime);
    }
  });

  const totalAccounts = uniqueAccounts.size;
  const accountsWithCreationTime = accountCreationTimes.size;

  if (totalAccounts > 0) {
    console.log(`Account creation clustering: ${accountsWithCreationTime} of ${totalAccounts} unique accounts have creation dates (${((accountsWithCreationTime/totalAccounts)*100).toFixed(1)}%)`);
  }

  const clusters = new Map();
  const sorted = Array.from(accountCreationTimes.entries()).sort((a, b) => a[1] - b[1]);

  sorted.forEach(([userId, time]) => {
    let foundCluster = false;

    for (const [clusterTime, accounts] of clusters) {
      if (Math.abs(time - clusterTime) < timeWindow) {
        accounts.add(userId);
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      clusters.set(time, new Set([userId]));
    }
  });

  return Array.from(clusters.values()).filter(cluster => cluster.size >= minClusterSize);
}

function detectTemporalBursts(postsByUser, timeWindow, minPosts = 5) {
  const bursts = [];

  postsByUser.forEach((posts, userId) => {
    const timestamps = posts.map(p => p.timestamp).sort((a, b) => a - b);

    for (let i = 0; i < timestamps.length; i++) {
      const windowEnd = timestamps[i] + timeWindow;
      let postsInWindow = 0;
      let j = i;

      while (j < timestamps.length && timestamps[j] < windowEnd) {
        postsInWindow++;
        j++;
      }

      if (postsInWindow >= minPosts) {
        bursts.push({
          userId,
          time: timestamps[i],
          count: postsInWindow,
          timestamps: timestamps.slice(i, j),
        });
        break;
      }
    }
  });

  return bursts;
}

// OPTIMIZED: Spatial indexing for synchronized posting detection
// This reduces O(n²×m) to O(n log n) by using time-based bucketing
function detectSynchronizedPostingOptimized(postsByUser, timeWindow, minSyncPosts) {
  // Bucket posts by time windows
  const bucketSize = timeWindow;
  const timeBuckets = new Map();

  postsByUser.forEach((posts, userId) => {
    posts.forEach(post => {
      const bucketKey = Math.floor(post.timestamp / bucketSize);

      // Add to current bucket and adjacent buckets to catch boundary cases
      for (let offset = -1; offset <= 1; offset++) {
        const key = bucketKey + offset;
        if (!timeBuckets.has(key)) {
          timeBuckets.set(key, new Map());
        }
        const bucket = timeBuckets.get(key);
        if (!bucket.has(userId)) {
          bucket.set(userId, []);
        }
        bucket.get(userId).push(post);
      }
    });
  });

  const synchronizedPairs = new Map();
  const processedPairs = new Set();

  // Only compare users within same time bucket
  timeBuckets.forEach((userPosts, bucketKey) => {
    const userIds = Array.from(userPosts.keys());

    // Compare only users who posted in this time window
    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const u1 = userIds[i];
        const u2 = userIds[j];

        // Create unique pair key
        const pairKey = u1 < u2 ? `${u1}|${u2}` : `${u2}|${u1}`;

        // Skip if already processed this pair
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        // Count synchronized posts for this pair
        const posts1 = postsByUser.get(u1);
        const posts2 = postsByUser.get(u2);

        let syncCount = 0;
        posts1.forEach(p1 => {
          posts2.forEach(p2 => {
            if (Math.abs(p1.timestamp - p2.timestamp) < timeWindow) {
              syncCount++;
            }
          });
        });

        if (syncCount >= minSyncPosts) {
          synchronizedPairs.set(pairKey, { u1, u2, syncCount });
        }
      }
    }
  });

  return Array.from(synchronizedPairs.values());
}

// Embedding functions
let extractor = null;
let transformersLoaded = false;

// Load Transformers.js library dynamically
async function loadTransformersLibrary() {
  if (transformersLoaded) return;

  return new Promise((resolve, reject) => {
    try {
      // Use importScripts for classic workers (not module workers)
      importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
      transformersLoaded = true;
      self.postMessage({ type: 'log', message: '✓ Transformers.js library loaded' });
      resolve();
    } catch (error) {
      self.postMessage({ type: 'log', message: `⚠️ Failed to load Transformers.js: ${error.message}` });
      reject(error);
    }
  });
}

async function initEmbeddingModel() {
  if (!extractor) {
    self.postMessage({ type: 'log', message: 'Loading embedding model (Xenova/all-MiniLM-L6-v2, ~23MB)...' });

    // Load library first
    await loadTransformersLibrary();

    // Access pipeline from global scope (importScripts makes it global)
    // Transformers.js exposes its API on self when loaded via importScripts
    let pipeline;

    // Try different possible global exports
    if (typeof self.pipeline === 'function') {
      pipeline = self.pipeline;
    } else if (self.transformers && typeof self.transformers.pipeline === 'function') {
      pipeline = self.transformers.pipeline;
    } else if (typeof window !== 'undefined' && typeof window.pipeline === 'function') {
      pipeline = window.pipeline;
    } else {
      throw new Error('Transformers.js pipeline not available. Library may not have loaded correctly. Available globals: ' + Object.keys(self).filter(k => k.includes('transform') || k.includes('pipeline')).join(', '));
    }

    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    self.postMessage({ type: 'log', message: '✓ Embedding model ready (384-dimensional vectors)' });
  }
  return extractor;
}

async function getEmbedding(text) {
  const model = await initEmbeddingModel();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function cosineSimilarity(vecA, vecB) {
  return vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
}

// Main CIB detection function
async function detectCIB(filteredData, params, timeWindow) {
  const results = { suspiciousUsers: new Set(), indicators: {} };

  self.postMessage({ type: 'progress', progress: 5, message: 'Calculating dataset statistics...' });

  // Calculate dataset statistics
  const stats = calculateDatasetStatistics(filteredData);

  self.postMessage({ type: 'progress', progress: 10, message: 'Detecting synchronized posting...' });

  // 1) Synchronized posting (OPTIMIZED with spatial indexing)
  const postsByUser = new Map();
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const timestamp = post.data?.createTime;
    if (!userId || !timestamp) return;
    if (!postsByUser.has(userId)) postsByUser.set(userId, []);
    postsByUser.get(userId).push({ timestamp, post });
  });

  // Use optimized detection
  const synchGroups = detectSynchronizedPostingOptimized(postsByUser, timeWindow, params.minSyncPosts);
  synchGroups.forEach(group => {
    results.suspiciousUsers.add(group.u1);
    results.suspiciousUsers.add(group.u2);
  });
  results.indicators.synchronized = synchGroups.length;

  self.postMessage({ type: 'progress', progress: 20, message: 'Analyzing hashtag patterns...' });

  // 2) Rare hashtag sequences with TF-IDF weighting
  const userHashtagSets = new Map();
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const hashtags = post.data?.challenges?.map(c => c.title) || [];
    if (!userId || !hashtags.length) return;

    if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
    hashtags.forEach(h => userHashtagSets.get(userId).push(h));
  });

  const hashtagSequences = new Map();
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const hashtags = post.data?.challenges?.map(c => c.title) || [];
    if (!userId || !hashtags.length) return;

    const allSets = Array.from(userHashtagSets.values()).map(arr => new Set(arr));
    const tfidfScore = hashtags.reduce((sum, h) => {
      return sum + calculateTFIDF(h, userHashtagSets.get(userId), allSets);
    }, 0) / hashtags.length;

    if (tfidfScore > params.tfidfThreshold) {
      const key = hashtags.sort().join(',');
      if (!hashtagSequences.has(key)) hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
      hashtagSequences.get(key).users.add(userId);
    }
  });

  let identicalHashtagUsers = 0;
  hashtagSequences.forEach((data, key) => {
    if (data.users.size >= params.minHashtagGroupSize) {
      data.users.forEach(u => results.suspiciousUsers.add(u));
      identicalHashtagUsers += data.users.size;
    }
  });
  results.indicators.identicalHashtags = identicalHashtagUsers;

  self.postMessage({ type: 'progress', progress: 30, message: 'Comparing usernames...' });

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

  self.postMessage({ type: 'progress', progress: 40, message: 'Detecting high-volume posters...' });

  // 4) High-volume posting with z-score normalization
  results.indicators.highVolume = 0;
  postsByUser.forEach((posts, userId) => {
    if (posts.length >= params.minHighVolumePosts) {
      const zScore = (posts.length - stats.posts.mean) / stats.posts.stdDev;

      if (zScore > params.zscoreThreshold) {
        results.suspiciousUsers.add(userId);
        results.indicators.highVolume++;
      }
    }
  });

  self.postMessage({ type: 'progress', progress: 50, message: 'Analyzing posting bursts...' });

  // 5) Temporal burst detection
  const bursts = detectTemporalBursts(postsByUser, timeWindow, params.burstPosts);
  results.indicators.temporalBursts = bursts.length;

  self.postMessage({ type: 'progress', progress: 55, message: 'Checking posting rhythms...' });

  // 6) Posting rhythm regularity & 24/7 activity
  postsByUser.forEach((posts, userId) => {
    const rhythm = analyzePostingRhythm(posts, params.rhythmCV);
    if (rhythm.regular) {
      results.suspiciousUsers.add(userId);
    }

    const nightPosting = analyzeNightPosting(posts, params.nightGap);
    if (nightPosting.suspicious) {
      results.suspiciousUsers.add(userId);
    }
  });

  self.postMessage({ type: 'progress', progress: 60, message: 'Analyzing captions...' });

  // 7) Semantic duplicate captions (AI-powered similarity)
  let semanticGroups = [];

  if (params.semanticEnabled) {
    self.postMessage({ type: 'progress', progress: 65, message: 'Loading AI model for semantic analysis...' });

    const captionEmbeddings = new Map();

    let processed = 0;
    const totalCaptions = filteredData.filter(p => {
      const caption = p.data?.desc || '';
      return p.data?.author?.id && caption.length >= 20;
    }).length;

    for (const post of filteredData) {
      const userId = post.data?.author?.id;
      const caption = post.data?.desc || '';
      if (!userId || caption.length < 20) continue;

      const embedding = await getEmbedding(caption);
      captionEmbeddings.set(userId, { caption, embedding, userId });

      processed++;
      if (processed % 10 === 0) {
        const embedProgress = 65 + Math.floor((processed / totalCaptions) * 10);
        self.postMessage({
          type: 'progress',
          progress: embedProgress,
          message: `Generating embeddings (${processed}/${totalCaptions})...`
        });
      }
    }

    self.postMessage({ type: 'progress', progress: 75, message: 'Comparing semantic similarity...' });

    const embedArray = Array.from(captionEmbeddings.values());
    for (let i = 0; i < embedArray.length; i++) {
      for (let j = i + 1; j < embedArray.length; j++) {
        const similarity = cosineSimilarity(embedArray[i].embedding, embedArray[j].embedding);

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

  self.postMessage({ type: 'progress', progress: 80, message: 'Detecting template captions...' });

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

  self.postMessage({ type: 'progress', progress: 85, message: 'Checking account creation patterns...' });

  // 9) Account creation clustering
  const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
  results.indicators.accountCreationClusters = creationClusters.length;

  if (creationClusters.length > 0) {
    console.log(`Found ${creationClusters.length} account creation clusters`);
  }

  self.postMessage({ type: 'progress', progress: 90, message: 'Calculating risk scores...' });

  // Build userId -> username lookup
  const userIdToName = new Map();
  filteredData.forEach(post => {
    const author = post.data?.author;
    if (author?.id) {
      userIdToName.set(author.id, author.uniqueId || author.nickname || `user_${author.id}`);
    }
  });

  // Calculate risk scores and reasons
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

    // Check rare hashtag sequences
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

    // Check similar usernames
    usernameGroups.forEach((users, key) => {
      if (users.has(userId) && users.size >= params.minUsernameGroupSize) {
        score += 10;
        const similarUsers = Array.from(users).filter(u => u !== userId).map(u => userIdToName.get(u) || u);
        const display = similarUsers.slice(0, 5);
        const more = similarUsers.length > 5 ? ` and ${similarUsers.length - 5} more` : '';
        reasons.push(`Similar username pattern with: ${display.join(', ')}${more}`);
      }
    });

    // Check high-volume posting
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

    // Check semantic duplicates
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

  self.postMessage({ type: 'progress', progress: 95, message: 'Finalizing analysis...' });

  // Cross-indicator bonus multiplier
  results.suspiciousUsers.forEach(userId => {
    const reasons = results.userReasons.get(userId) || [];
    const numIndicators = reasons.length;
    let baseScore = results.userScores.get(userId) || 0;

    if (numIndicators >= 2) {
      const multiplier = 1 + (params.crossMultiplier * numIndicators);
      baseScore = Math.min(100, baseScore * multiplier);
      results.userScores.set(userId, Math.round(baseScore));
    }

    const reasonText = reasons.join(' ').toLowerCase();

    if (reasonText.includes('similar username') && reasonText.includes('created with')) {
      const currentScore = results.userScores.get(userId);
      results.userScores.set(userId, Math.min(100, currentScore + 20));
    }

    if (reasonText.includes('synchronized') && reasonText.includes('regular posting')) {
      const currentScore = results.userScores.get(userId);
      results.userScores.set(userId, Math.min(100, currentScore + 15));
    }
  });

  // Convert Sets and Maps to arrays for JSON serialization
  const serializedResults = {
    suspiciousUsers: Array.from(results.suspiciousUsers),
    indicators: results.indicators,
    userScores: Array.from(results.userScores.entries()),
    userReasons: Array.from(results.userReasons.entries())
  };

  self.postMessage({ type: 'progress', progress: 100, message: 'Analysis complete!' });

  return serializedResults;
}

// Worker message handler
self.onmessage = async function(e) {
  const { type, data, params, timeWindow } = e.data;

  if (type === 'detectCIB') {
    try {
      const result = await detectCIB(data, params, timeWindow);
      self.postMessage({ type: 'complete', result });
    } catch (error) {
      self.postMessage({ type: 'error', error: error.message, stack: error.stack });
    }
  }
};
