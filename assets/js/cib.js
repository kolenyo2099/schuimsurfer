import {
  calculateDatasetStatistics,
  calculateTFIDF,
  ngramOverlap,
  levenshteinDistance,
  analyzePostingRhythm,
  analyzeNightPosting,
  detectAccountCreationClusters,
  detectTemporalBursts,
} from './analytics.js';
import { initEmbeddingModel, getEmbeddingsBatch, cosineSimilarity } from './embeddings.js';

function formatTimeWindow(seconds) {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `${minutes}m ${remainder}s`;
}

export async function runCibAnalysis(filteredData, params, timeWindow) {
  const results = {
    suspiciousUsers: new Set(),
    indicators: {
      synchronized: 0,
      identicalHashtags: 0,
      similarUsernames: 0,
      highVolume: 0,
      temporalBursts: 0,
      semanticDuplicates: 0,
      templateCaptions: 0,
      duplicateCaptions: 0,
      accountCreationClusters: 0,
    },
    userScores: new Map(),
    userReasons: new Map(),
  };

  const stats = calculateDatasetStatistics(filteredData);

  const postsByUser = new Map();
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const timestamp = post.data?.createTime;
    if (!userId || !timestamp) return;
    if (!postsByUser.has(userId)) postsByUser.set(userId, []);
    postsByUser.get(userId).push({ timestamp, post });
  });

  // 1) Synchronized posting
  const timeWindowSec = Number.isFinite(timeWindow) ? timeWindow : 300;
  const synchGroups = [];
  const userEntries = Array.from(postsByUser.entries());
  for (let i = 0; i < userEntries.length; i++) {
    for (let j = i + 1; j < userEntries.length; j++) {
      const [u1, posts1] = userEntries[i];
      const [u2, posts2] = userEntries[j];
      let syncCount = 0;
      posts1.forEach(a => {
        posts2.forEach(b => {
          if (Math.abs(a.timestamp - b.timestamp) < timeWindowSec) syncCount++;
        });
      });
      if (syncCount >= params.minSyncPosts) {
        results.suspiciousUsers.add(u1);
        results.suspiciousUsers.add(u2);
        synchGroups.push({ u1, u2, syncCount });
      }
    }
  }
  results.indicators.synchronized = synchGroups.length;

  // 2) Rare hashtag sequences with TF-IDF weighting
  const userHashtagSets = new Map();
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const hashtags = post.data?.challenges?.map(c => c.title).filter(Boolean) || [];
    if (!userId || !hashtags.length) return;
    if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
    hashtags.forEach(h => userHashtagSets.get(userId).push(h));
  });

  const hashtagSequences = new Map();
  const allSets = Array.from(userHashtagSets.values()).map(arr => new Set(arr));
  filteredData.forEach(post => {
    const userId = post.data?.author?.id;
    const hashtags = post.data?.challenges?.map(c => c.title).filter(Boolean) || [];
    if (!userId || !hashtags.length) return;

    const tfidfScore = hashtags.reduce((sum, h) => sum + calculateTFIDF(h, userHashtagSets.get(userId), allSets), 0) / hashtags.length;
    if (tfidfScore > params.tfidfThreshold) {
      const key = [...hashtags].sort().join(',');
      if (!hashtagSequences.has(key)) {
        hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
      }
      hashtagSequences.get(key).users.add(userId);
    }
  });

  let identicalHashtagUsers = 0;
  hashtagSequences.forEach(data => {
    if (data.users.size >= params.minHashtagGroupSize) {
      data.users.forEach(u => results.suspiciousUsers.add(u));
      identicalHashtagUsers += data.users.size;
    }
  });
  results.indicators.identicalHashtags = identicalHashtagUsers;

  // 3) Similar usernames via Levenshtein distance
  const usernames = new Map();
  filteredData.forEach(post => {
    const author = post.data?.author;
    if (!author) return;
    const username = author.uniqueId || author.nickname || '';
    const userId = author.id;
    if (!userId || username.length < 4) return;
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
  usernameGroups.forEach(users => {
    if (users.size >= params.minUsernameGroupSize) {
      users.forEach(u => results.suspiciousUsers.add(u));
      similarUsernameCount += users.size;
    }
  });
  results.indicators.similarUsernames = similarUsernameCount;

  // 4) High-volume posting (z-score)
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

  // 5) Temporal bursts
  const bursts = detectTemporalBursts(postsByUser, timeWindowSec, params.burstPosts);
  results.indicators.temporalBursts = bursts.length;

  // 6) Posting rhythm and night activity
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

  // 7) Semantic duplicate captions
  let semanticGroups = [];
  if (params.semanticEnabled) {
    await initEmbeddingModel();
    const captionInputs = [];
    const userRefs = [];
    filteredData.forEach(post => {
      const userId = post.data?.author?.id;
      const caption = post.data?.desc || '';
      if (!userId || caption.length < 20) return;
      captionInputs.push(caption);
      userRefs.push({ userId, caption });
    });

    const embeddings = captionInputs.length > 0 ? await getEmbeddingsBatch(captionInputs) : [];
    const captionEmbeddings = userRefs.map((ref, idx) => ({ ...ref, embedding: embeddings[idx] }));

    for (let i = 0; i < captionEmbeddings.length; i++) {
      for (let j = i + 1; j < captionEmbeddings.length; j++) {
        const similarity = cosineSimilarity(captionEmbeddings[i].embedding, captionEmbeddings[j].embedding);
        if (similarity >= params.semanticThreshold) {
          results.suspiciousUsers.add(captionEmbeddings[i].userId);
          results.suspiciousUsers.add(captionEmbeddings[j].userId);
          semanticGroups.push({
            users: [captionEmbeddings[i].userId, captionEmbeddings[j].userId],
            similarity: similarity.toFixed(3),
            captions: [captionEmbeddings[i].caption.slice(0, 50), captionEmbeddings[j].caption.slice(0, 50)],
          });
        }
      }
    }
  }
  results.indicators.semanticDuplicates = semanticGroups.length;

  // 8) Template captions via n-grams
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
        captionPairs.push({ users: [captionArray[i][0], captionArray[j][0]], overlap });
        results.suspiciousUsers.add(captionArray[i][0]);
        results.suspiciousUsers.add(captionArray[j][0]);
      }
    }
  }
  results.indicators.templateCaptions = captionPairs.length;
  results.indicators.duplicateCaptions = semanticGroups.length + captionPairs.length;

  // 9) Account creation clustering
  const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
  results.indicators.accountCreationClusters = creationClusters.length;

  // Build userId -> username lookup for reason strings
  const userIdToName = new Map();
  filteredData.forEach(post => {
    const author = post.data?.author;
    if (author?.id) {
      userIdToName.set(author.id, author.uniqueId || author.nickname || `user_${author.id}`);
    }
  });

  const timeWindowLabel = formatTimeWindow(timeWindowSec);

  results.suspiciousUsers.forEach(userId => {
    let score = 0;
    const reasons = [];

    const userSyncGroups = synchGroups.filter(g => g.u1 === userId || g.u2 === userId);
    if (userSyncGroups.length > 0) {
      score += 25;
      const partners = userSyncGroups.map(g => {
        const partnerId = g.u1 === userId ? g.u2 : g.u1;
        return userIdToName.get(partnerId) || partnerId;
      });
      const summary = partners.slice(0, 5).join(', ');
      const extra = partners.length > 5 ? ` and ${partners.length - 5} more` : '';
      reasons.push(`Synchronized posting with: ${summary}${extra}`);
    }

    const hashtagPartners = [];
    hashtagSequences.forEach(data => {
      if (data.users.has(userId) && data.users.size >= params.minHashtagGroupSize) {
        const others = Array.from(data.users).filter(u => u !== userId).map(u => userIdToName.get(u) || u);
        hashtagPartners.push(...others);
      }
    });
    if (hashtagPartners.length > 0) {
      score += 20;
      const summary = hashtagPartners.slice(0, 5).join(', ');
      const extra = hashtagPartners.length > 5 ? ` and ${hashtagPartners.length - 5} more` : '';
      reasons.push(`Rare hashtag combinations with: ${summary}${extra}`);
    }

    usernameGroups.forEach(users => {
      if (users.has(userId) && users.size >= params.minUsernameGroupSize) {
        score += 10;
        const similarUsers = Array.from(users)
          .filter(u => u !== userId)
          .map(u => userIdToName.get(u) || u);
        const summary = similarUsers.slice(0, 5).join(', ');
        const extra = similarUsers.length > 5 ? ` and ${similarUsers.length - 5} more` : '';
        reasons.push(`Similar username pattern with: ${summary}${extra}`);
      }
    });

    const posts = postsByUser.get(userId) || [];
    if (posts.length >= params.minHighVolumePosts) {
      const zScore = (posts.length - stats.posts.mean) / stats.posts.stdDev;
      if (zScore > params.zscoreThreshold) {
        score += 15;
        reasons.push(`High-volume posting (z-score: ${zScore.toFixed(1)})`);
      }
    }

    const userBursts = bursts.filter(b => b.userId === userId);
    if (userBursts.length > 0) {
      score += 15;
      userBursts.forEach(burst => {
        reasons.push(`Posting burst: ${burst.count} posts in ${timeWindowLabel}`);
      });
    }

    const rhythm = analyzePostingRhythm(posts, params.rhythmCV);
    if (rhythm.regular) {
      score += 20;
      if (Number.isFinite(rhythm.cv)) {
        reasons.push(`Highly regular posting rhythm (CV: ${(rhythm.cv * 100).toFixed(1)}%)`);
      } else {
        reasons.push('Highly regular posting rhythm');
      }
    }

    const night = analyzeNightPosting(posts, params.nightGap);
    if (night.suspicious) {
      score += 25;
      if (Number.isFinite(night.avgMaxGap)) {
        reasons.push(`24/7 posting pattern (max gap: ${Math.floor(night.avgMaxGap / 3600)}h)`);
      } else {
        reasons.push('24/7 posting pattern');
      }
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
      const currentScore = results.userScores.get(userId) || 0;
      results.userScores.set(userId, Math.min(100, currentScore + 20));
    }
    if (reasonText.includes('synchronized') && reasonText.includes('regular posting')) {
      const currentScore = results.userScores.get(userId) || 0;
      results.userScores.set(userId, Math.min(100, currentScore + 15));
    }
  });

  return {
    suspiciousUsers: Array.from(results.suspiciousUsers),
    indicators: results.indicators,
    userScores: Array.from(results.userScores.entries()),
    userReasons: Array.from(results.userReasons.entries()),
  };
}
