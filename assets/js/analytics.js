export function calculateStats(rawData) {
  const uniqueUsers = new Set(rawData.map(p => p.data?.author?.id).filter(Boolean));
  const allHashtags = rawData.flatMap(p => p.data?.challenges?.map(c => c.title) || []);
  const uniqueHashtags = new Set(allHashtags);

  const totalEngagement = rawData.reduce((sum, p) => {
    return sum + (p.data?.stats?.diggCount || 0) + (p.data?.stats?.commentCount || 0);
  }, 0);

  return {
    posts: rawData.length,
    users: uniqueUsers.size,
    hashtags: uniqueHashtags.size,
    engagement: rawData.length ? Math.round(totalEngagement / rawData.length) : 0,
  };
}

export function filterData(rawData, { minEngagement, startDate, endDate, onDebug } = {}) {
  const minimum = Number.isFinite(minEngagement) ? minEngagement : 0;
  const start = Number.isFinite(startDate) ? startDate : 0;
  const end = Number.isFinite(endDate) ? endDate : Infinity;

  let debugCount = 0;
  return rawData.filter(post => {
    const engagement = (post.data?.stats?.diggCount || 0) +
                       (post.data?.stats?.commentCount || 0) +
                       (post.data?.stats?.shareCount || 0);
    const postTime = post.data?.createTime;

    const passesDateFilter = !postTime
      ? (!Number.isFinite(startDate) && !Number.isFinite(endDate))
      : (postTime >= start && postTime <= end);

    const passesEngagement = engagement >= minimum;

    if (onDebug && debugCount < 3 && (!passesEngagement || !passesDateFilter)) {
      onDebug(post, {
        engagement,
        minEngagement: minimum,
        passesEngagement,
        postTime,
        hasDateStart: Number.isFinite(startDate),
        hasDateEnd: Number.isFinite(endDate),
        passesDateFilter,
        createTime: post.data?.createTime,
      });
      debugCount += 1;
    }

    return passesEngagement && passesDateFilter;
  });
}

export function calculateDatasetStatistics(filteredData) {
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

export function calculateTFIDF(hashtag, userHashtags, allHashtags) {
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

export function getNGrams(text, n = 5) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const ngrams = [];

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

export function ngramOverlap(textA, textB, n = 5) {
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

export function levenshteinDistance(a, b) {
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

export function analyzePostingRhythm(posts, cvThreshold = 0.1) {
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

export function analyzeNightPosting(posts, gapThreshold = 7200) {
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

export function detectAccountCreationClusters(posts, timeWindow = 86400, minClusterSize = 5) {
  const accountCreationTimes = new Map();
  const uniqueAccounts = new Set();

  posts.forEach(post => {
    const author = post.data?.author;
    if (!author?.id) return;
    
    uniqueAccounts.add(author.id);

    // Only use author.createTime (account creation), never fall back to post creation time
    const creationTime = author.createTime;
    if (!creationTime) return;

    // Store the creation time for this account (only once per account)
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

export function detectTemporalBursts(postsByUser, timeWindow, minPosts = 5) {
  const bursts = [];

  postsByUser.forEach((posts, userId) => {
    const timestamps = posts.map(p => p.timestamp).sort((a, b) => a - b);
    if (timestamps.length === 0) return;

    let start = 0;
    for (let end = 0; end < timestamps.length; end++) {
      while (start < end && (timestamps[end] - timestamps[start]) >= timeWindow) {
        start++;
      }

      const windowSize = end - start + 1;
      if (windowSize >= minPosts) {
        bursts.push({
          userId,
          time: timestamps[start],
          count: windowSize,
          timestamps: timestamps.slice(start, end + 1),
        });
        break;
      }
    }
  });

  return bursts;
}
