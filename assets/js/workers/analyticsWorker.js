import {
  calculateDatasetStatistics,
  calculateTFIDF,
  ngramOverlap,
  levenshteinDistance,
  analyzePostingRhythm,
  analyzeNightPosting,
  detectAccountCreationClusters,
  detectTemporalBursts,
} from '../analytics.js';
import {
  initEmbeddingModel,
  getEmbeddings,
  cosineSimilarity,
} from '../embeddings.js';

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {};
  if (type !== 'detect-cib') return;

  try {
    const results = await runCibDetection(payload);
    self.postMessage({ type: 'cib-results', results });
  } catch (err) {
    self.postMessage({ type: 'cib-error', message: err?.message || String(err) });
  }
});

function postProgress(message) {
  self.postMessage({ type: 'cib-progress', message });
}

async function runCibDetection(payload = {}) {
  const {
    filteredData = [],
    threshold = 5,
    params: incomingParams = {},
    timeWindow = 300,
  } = payload;

  const params = {
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
    ...incomingParams,
  };

  postProgress('Preparing dataset for CIB analysis...');

  const sensitivity = 11 - threshold;
  const results = { suspiciousUsers: new Set(), indicators: {} };

  const postsByUser = new Map();
  filteredData.forEach(post => {
    const userId = post?.data?.author?.id;
    const timestamp = post?.data?.createTime;
    if (!userId || !Number.isFinite(timestamp)) return;
    if (!postsByUser.has(userId)) postsByUser.set(userId, []);
    postsByUser.get(userId).push({ timestamp, post });
  });

  const stats = calculateDatasetStatistics(filteredData);
  postProgress('Scanning for synchronized posting...');

  const synchGroups = [];
  const userTs = Array.from(postsByUser.entries());
  for (let i = 0; i < userTs.length; i++) {
    for (let j = i + 1; j < userTs.length; j++) {
      const [u1, p1] = userTs[i];
      const [u2, p2] = userTs[j];
      let syncCount = 0;
      for (let a = 0; a < p1.length; a++) {
        for (let b = 0; b < p2.length; b++) {
          if (Math.abs(p1[a].timestamp - p2[b].timestamp) < timeWindow) {
            syncCount++;
          }
        }
      }
      if (syncCount >= Math.max(2, Math.floor(10 / sensitivity))) {
        results.suspiciousUsers.add(u1);
        results.suspiciousUsers.add(u2);
        synchGroups.push({ u1, u2, syncCount });
      }
    }
  }
  results.indicators.synchronized = synchGroups.length;

  postProgress('Evaluating hashtag coordination...');

  const userHashtagSets = new Map();
  filteredData.forEach(post => {
    const userId = post?.data?.author?.id;
    if (!userId) return;
    const hashtags = post?.data?.challenges?.map(c => c.title).filter(Boolean) || [];
    if (!hashtags.length) return;
    if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
    hashtags.forEach(h => userHashtagSets.get(userId).push(h));
  });

  const allHashtagSets = Array.from(userHashtagSets.values()).map(arr => new Set(arr));
  const hashtagSequences = new Map();
  filteredData.forEach(post => {
    const userId = post?.data?.author?.id;
    if (!userId) return;
    const hashtags = post?.data?.challenges?.map(c => c.title).filter(Boolean) || [];
    if (!hashtags.length) return;

    const userHashtags = userHashtagSets.get(userId) || [];
    const tfidfScore = hashtags.reduce((sum, h) => sum + calculateTFIDF(h, userHashtags, allHashtagSets), 0) / hashtags.length;

    if (tfidfScore > params.tfidfThreshold) {
      const key = [...hashtags].sort().join(',');
      if (!hashtagSequences.has(key)) hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
      hashtagSequences.get(key).users.add(userId);
    }
  });

  let identicalHashtagUsers = 0;
  hashtagSequences.forEach(data => {
    if (data.users.size >= Math.max(3, Math.floor(15 / sensitivity))) {
      data.users.forEach(u => results.suspiciousUsers.add(u));
      identicalHashtagUsers += data.users.size;
    }
  });
  results.indicators.identicalHashtags = identicalHashtagUsers;

  postProgress('Comparing usernames...');

  const usernames = new Map();
  filteredData.forEach(post => {
    const author = post?.data?.author;
    if (!author?.id) return;
    const username = author.uniqueId || author.nickname || '';
    if (username.length < 4) return;
    usernames.set(author.id, username);
  });

  const usernameGroups = new Map();
  const usernameArray = Array.from(usernames.entries());
  for (let i = 0; i < usernameArray.length; i++) {
    for (let j = i + 1; j < usernameArray.length; j++) {
      const [id1, name1] = usernameArray[i];
      const [id2, name2] = usernameArray[j];
      const distance = levenshteinDistance(name1, name2);
      const maxLen = Math.max(name1.length, name2.length);
      const similarity = maxLen === 0 ? 0 : 1 - (distance / maxLen);
      if (similarity >= params.usernameThreshold) {
        const key = [name1, name2].sort().join('|');
        if (!usernameGroups.has(key)) usernameGroups.set(key, new Set());
        usernameGroups.get(key).add(id1);
        usernameGroups.get(key).add(id2);
      }
    }
  }

  let similarUsernameCount = 0;
  usernameGroups.forEach(users => {
    if (users.size >= Math.max(3, Math.floor(12 / sensitivity))) {
      users.forEach(u => results.suspiciousUsers.add(u));
      similarUsernameCount += users.size;
    }
  });
  results.indicators.similarUsernames = similarUsernameCount;

  postProgress('Measuring posting volume...');

  const minPosts = Math.max(5, Math.floor(25 / sensitivity));
  let highVolumeCount = 0;
  postsByUser.forEach((posts, userId) => {
    if (posts.length >= minPosts && Number.isFinite(stats.posts?.stdDev) && stats.posts.stdDev > 0) {
      const zScore = (posts.length - stats.posts.mean) / stats.posts.stdDev;
      if (zScore > params.zscoreThreshold) {
        results.suspiciousUsers.add(userId);
        highVolumeCount++;
      }
    }
  });
  results.indicators.highVolume = highVolumeCount;

  postProgress('Detecting temporal bursts...');
  const bursts = detectTemporalBursts(postsByUser, timeWindow, params.burstPosts);
  results.indicators.temporalBursts = bursts.length;

  postProgress('Evaluating rhythm and night activity...');
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

  let semanticGroups = [];
  let captionPairs = [];

  if (params.semanticEnabled) {
    postProgress('Computing semantic caption similarity...');
    await initEmbeddingModel();
    const captionItems = [];
    filteredData.forEach(post => {
      const userId = post?.data?.author?.id;
      const caption = post?.data?.desc || '';
      if (!userId || caption.length < 20) return;
      captionItems.push({ userId, caption });
    });

    const embeddings = await getEmbeddings(captionItems.map(item => item.caption));
    const captionEmbeddings = new Map();
    captionItems.forEach((item, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) return;
      captionEmbeddings.set(item.userId, { userId: item.userId, caption: item.caption, embedding });
    });

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
            captions: [embedArray[i].caption.slice(0, 50), embedArray[j].caption.slice(0, 50)],
          });
        }
      }
    }
  }

  postProgress('Comparing caption templates...');

  const captions = new Map();
  filteredData.forEach(post => {
    const userId = post?.data?.author?.id;
    const caption = post?.data?.desc || '';
    if (!userId || caption.length < 20) return;
    captions.set(userId, caption);
  });

  const captionArray = Array.from(captions.entries());
  for (let i = 0; i < captionArray.length; i++) {
    for (let j = i + 1; j < captionArray.length; j++) {
      const overlap = ngramOverlap(captionArray[i][1], captionArray[j][1]);
      if (overlap >= params.ngramThreshold) {
        captionPairs.push({ users: [captionArray[i][0], captionArray[j][0]], overlap });
        results.suspiciousUsers.add(captionArray[i][0]);
        results.suspiciousUsers.add(captionArray[j][0]);
      }
    }
  }

  results.indicators.semanticDuplicates = semanticGroups.length;
  results.indicators.templateCaptions = captionPairs.length;
  results.indicators.duplicateCaptions = semanticGroups.length + captionPairs.length;

  postProgress('Inspecting account creation clusters...');
  const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
  results.indicators.accountCreationClusters = creationClusters.length;

  const userIdToName = new Map();
  filteredData.forEach(post => {
    const author = post?.data?.author;
    if (author?.id) {
      userIdToName.set(author.id, author.uniqueId || author.nickname || `user_${author.id}`);
    }
  });

  postProgress('Scoring suspicious accounts...');
  results.userScores = new Map();
  results.userReasons = new Map();

  results.suspiciousUsers.forEach(userId => {
    let score = 0;
    const reasons = [];

    const userSyncGroups = synchGroups.filter(g => g.u1 === userId || g.u2 === userId);
    if (userSyncGroups.length > 0) {
      score += 25;
      const partners = userSyncGroups.map(g => (g.u1 === userId ? g.u2 : g.u1)).slice(0, 5).map(id => userIdToName.get(id) || id);
      const more = userSyncGroups.length > 5 ? ` and ${userSyncGroups.length - 5} more` : '';
      reasons.push(`Synchronized posting with: ${partners.join(', ')}${more}`);
    }

    const userHashtags = filteredData.filter(p => p?.data?.author?.id === userId);
    const hashtagPartners = [];
    hashtagSequences.forEach(data => {
      if (data.users.has(userId) && data.users.size >= Math.max(3, Math.floor(15 / sensitivity))) {
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

    usernameGroups.forEach(users => {
      if (users.has(userId) && users.size >= Math.max(3, Math.floor(12 / sensitivity))) {
        score += 10;
        const similarUsers = Array.from(users).filter(u => u !== userId).map(u => userIdToName.get(u) || u);
        const display = similarUsers.slice(0, 5);
        const more = similarUsers.length > 5 ? ` and ${similarUsers.length - 5} more` : '';
        reasons.push(`Similar username pattern with: ${display.join(', ')}${more}`);
      }
    });

    if (userHashtags.length >= minPosts && Number.isFinite(stats.posts?.stdDev) && stats.posts.stdDev > 0) {
      const zScore = (userHashtags.length - stats.posts.mean) / stats.posts.stdDev;
      if (zScore > 2) {
        score += 15;
        reasons.push(`High-volume posting (z-score: ${zScore.toFixed(1)})`);
      }
    }

    const userBursts = bursts.filter(b => b.userId === userId);
    if (userBursts.length > 0) {
      score += 15;
      userBursts.forEach(burst => {
        const timeDesc = timeWindow < 60 ? `${timeWindow} second${timeWindow !== 1 ? 's' : ''}` : `${Math.floor(timeWindow / 60)} minute${Math.floor(timeWindow / 60) !== 1 ? 's' : ''}`;
        reasons.push(`Posting burst: ${burst.count} posts in ${timeDesc}`);
      });
    }

    const rhythm = analyzePostingRhythm(userHashtags.map(p => ({ timestamp: p.data?.createTime })).filter(p => p.timestamp), params.rhythmCV);
    if (rhythm.regular) {
      score += 20;
      reasons.push(`Highly regular posting rhythm (CV: ${(rhythm.cv * 100).toFixed(1)}%)`);
    }

    const nightPosting = analyzeNightPosting(userHashtags.map(p => ({ timestamp: p.data?.createTime })).filter(p => p.timestamp), params.nightGap);
    if (nightPosting.suspicious) {
      score += 25;
      reasons.push(`24/7 posting pattern (max gap: ${Math.floor(nightPosting.avgMaxGap / 3600)}h)`);
    }

    semanticGroups.forEach(group => {
      if (group.users.includes(userId)) {
        score += 25;
        const partner = group.users.find(u => u !== userId);
        const partnerName = userIdToName.get(partner) || partner;
        reasons.push(`Semantically similar captions (${group.similarity}) with ${partnerName}`);
      }
    });

    captionPairs.forEach(pair => {
      if (pair.users.includes(userId)) {
        score += 20;
        const partner = pair.users.find(u => u !== userId);
        const partnerName = userIdToName.get(partner) || partner;
        reasons.push(`Template caption (${(pair.overlap * 100).toFixed(0)}% overlap) with ${partnerName}`);
      }
    });

    creationClusters.forEach(cluster => {
      if (cluster.has(userId)) {
        score += 30;
        reasons.push(`Account created with ${cluster.size - 1} others within 24 hours`);
      }
    });

    results.userScores.set(userId, score);
    results.userReasons.set(userId, reasons);
  });

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
      const current = results.userScores.get(userId) || 0;
      results.userScores.set(userId, Math.min(100, current + 20));
    }
    if (reasonText.includes('synchronized') && reasonText.includes('regular posting')) {
      const current = results.userScores.get(userId) || 0;
      results.userScores.set(userId, Math.min(100, current + 15));
    }
  });

  return {
    suspiciousUsers: Array.from(results.suspiciousUsers),
    indicators: results.indicators,
    userScores: Array.from(results.userScores.entries()),
    userReasons: Array.from(results.userReasons.entries()),
  };
}
