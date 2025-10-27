import { initEmbeddingModel, getEmbeddingsBatch, cosineSimilarity } from '../embeddings.js';
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

const PROGRESS_THROTTLE_MS = 120;

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function createProgressReporter(jobId) {
  let lastEmit = 0;
  return (stage, current, total, force = false) => {
    const timestamp = now();
    if (
      force ||
      typeof current !== 'number' ||
      typeof total !== 'number' ||
      current >= total ||
      timestamp - lastEmit >= PROGRESS_THROTTLE_MS
    ) {
      lastEmit = timestamp;
      const payload = { type: 'progress', jobId, stage, message: stage };
      if (typeof current === 'number') payload.current = current;
      if (typeof total === 'number') payload.total = total;
      postMessage(payload);
    }
  };
}

function computeProgressStep(total) {
  if (!Number.isFinite(total) || total <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(total / 100));
}

self.onmessage = async (event) => {
  const { data } = event;
  if (!data) return;

  if (data.type === 'run') {
    const jobId = data.jobId ?? Date.now();
    try {
      const results = await runCibAnalysis(data, jobId);
      postMessage({ type: 'result', jobId, results });
    } catch (error) {
      postMessage({ type: 'error', jobId, message: error?.message || 'CIB analysis failed' });
    }
  }
};

async function runCibAnalysis(payload, jobId) {
  const {
    filteredData = [],
    params,
    timeWindow,
  } = payload;

  const report = createProgressReporter(jobId);

  report('Preparing coordinated-behavior analysis…');

  const results = {
    suspiciousUsers: new Set(),
    indicators: {},
  };

  const postsByUser = new Map();
  const userHashtagSets = new Map();
  const usernames = new Map();

  const totalPosts = filteredData.length;
  const indexStep = computeProgressStep(totalPosts);
  report('Indexing posts…', 0, totalPosts, true);

  for (let i = 0; i < filteredData.length; i++) {
    const post = filteredData[i];
    const userId = post.data?.author?.id;
    const timestamp = post.data?.createTime;
    if (!userId || !timestamp) continue;

    if (!postsByUser.has(userId)) postsByUser.set(userId, []);
    postsByUser.get(userId).push({ timestamp, post });

    const hashtags = post.data?.challenges?.map(c => c.title) || [];
    if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
    hashtags.forEach(h => userHashtagSets.get(userId).push(h));

    const author = post.data?.author;
    if (author) {
      const username = author.uniqueId || author.nickname || '';
      if (username.length >= 4) {
        usernames.set(userId, username);
      }
    }

    if ((i + 1) % indexStep === 0 || i + 1 === totalPosts) {
      report('Indexing posts…', i + 1, totalPosts);
    }
  }

  report('Indexing posts…', totalPosts, totalPosts, true);

  const stats = calculateDatasetStatistics(filteredData);

  // 1) Synchronized posting
  const synchGroups = [];
  const userTs = Array.from(postsByUser.entries());
  const syncTotal = (userTs.length * (userTs.length - 1)) / 2;
  let syncProcessed = 0;
  const syncStep = computeProgressStep(syncTotal);
  report('Scanning for synchronized posting…', 0, syncTotal, true);
  for (let i = 0; i < userTs.length; i++) {
    for (let j = i + 1; j < userTs.length; j++) {
      const [u1, p1] = userTs[i];
      const [u2, p2] = userTs[j];
      let syncCount = 0;
      p1.forEach(a => p2.forEach(b => { if (Math.abs(a.timestamp - b.timestamp) < timeWindow) syncCount++; }));
      if (syncCount >= params.minSyncPosts) {
        results.suspiciousUsers.add(u1);
        results.suspiciousUsers.add(u2);
        synchGroups.push({ u1, u2, syncCount });
      }
      syncProcessed++;
      if (syncProcessed % syncStep === 0 || syncProcessed === syncTotal) {
        report('Scanning for synchronized posting…', syncProcessed, syncTotal);
      }
    }
  }
  report('Scanning for synchronized posting…', syncTotal, syncTotal, true);
  results.indicators.synchronized = synchGroups.length;

  // 2) Rare hashtag sequences with TF-IDF weighting
  const hashtagSequences = new Map();
  const allSets = Array.from(userHashtagSets.values()).map(arr => new Set(arr));

  report('Evaluating hashtag combinations…', 0, totalPosts, true);
  for (let i = 0; i < filteredData.length; i++) {
    const post = filteredData[i];
    const userId = post.data?.author?.id;
    const hashtags = post.data?.challenges?.map(c => c.title) || [];
    if (userId && hashtags.length) {
      const tfidfScore = hashtags.reduce((sum, h) => {
        return sum + calculateTFIDF(h, userHashtagSets.get(userId) || [], allSets);
      }, 0) / hashtags.length;

      if (tfidfScore > params.tfidfThreshold) {
        const key = hashtags.slice().sort().join(',');
        if (!hashtagSequences.has(key)) hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
        hashtagSequences.get(key).users.add(userId);
      }
    }

    if ((i + 1) % indexStep === 0 || i + 1 === totalPosts) {
      report('Evaluating hashtag combinations…', i + 1, totalPosts);
    }
  }
  report('Evaluating hashtag combinations…', totalPosts, totalPosts, true);

  let identicalHashtagUsers = 0;
  hashtagSequences.forEach(data => {
    if (data.users.size >= params.minHashtagGroupSize) {
      data.users.forEach(u => results.suspiciousUsers.add(u));
      identicalHashtagUsers += data.users.size;
    }
  });
  results.indicators.identicalHashtags = identicalHashtagUsers;

  // 3) Similar usernames with Levenshtein distance
  const usernameGroups = new Map();
  const usernameArray = Array.from(usernames.entries());

  const usernameTotal = (usernameArray.length * (usernameArray.length - 1)) / 2;
  let usernameProcessed = 0;
  const usernameStep = computeProgressStep(usernameTotal);
  report('Comparing usernames…', 0, usernameTotal, true);

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

      usernameProcessed++;
      if (usernameProcessed % usernameStep === 0 || usernameProcessed === usernameTotal) {
        report('Comparing usernames…', usernameProcessed, usernameTotal);
      }
    }
  }
  report('Comparing usernames…', usernameTotal, usernameTotal, true);

  let similarUsernameCount = 0;
  usernameGroups.forEach(users => {
    if (users.size >= params.minUsernameGroupSize) {
      users.forEach(u => results.suspiciousUsers.add(u));
      similarUsernameCount += users.size;
    }
  });
  results.indicators.similarUsernames = similarUsernameCount;

  // 4) High-volume posting
  results.indicators.highVolume = 0;
  const postsEntries = Array.from(postsByUser.entries());
  const volumeStep = computeProgressStep(postsEntries.length);
  report('Evaluating posting volume…', 0, postsEntries.length, true);
  postsEntries.forEach(([userId, posts], index) => {
    if (posts.length >= params.minHighVolumePosts) {
      const zScore = (posts.length - stats.posts.mean) / (stats.posts.stdDev || 1);
      if (zScore > params.zscoreThreshold) {
        results.suspiciousUsers.add(userId);
        results.indicators.highVolume++;
      }
    }

    const processed = index + 1;
    if (processed % volumeStep === 0 || processed === postsEntries.length) {
      report('Evaluating posting volume…', processed, postsEntries.length);
    }
  });
  report('Evaluating posting volume…', postsEntries.length, postsEntries.length, true);

  // 5) Temporal bursts
  report('Detecting posting bursts…', 0, 1, true);
  const bursts = detectTemporalBursts(postsByUser, timeWindow, params.burstPosts);
  results.indicators.temporalBursts = bursts.length;
  report('Detecting posting bursts…', 1, 1, true);

  // 6) Posting rhythm & night activity
  report('Analyzing rhythms and night activity…', 0, postsEntries.length, true);
  postsEntries.forEach(([userId, posts], index) => {
    const rhythm = analyzePostingRhythm(posts, params.rhythmCV);
    if (rhythm.regular) {
      results.suspiciousUsers.add(userId);
    }

    const nightPosting = analyzeNightPosting(posts, params.nightGap);
    if (nightPosting.suspicious) {
      results.suspiciousUsers.add(userId);
    }

    const processed = index + 1;
    if (processed % volumeStep === 0 || processed === postsEntries.length) {
      report('Analyzing rhythms and night activity…', processed, postsEntries.length);
    }
  });
  report('Analyzing rhythms and night activity…', postsEntries.length, postsEntries.length, true);

  // 7) Semantic duplicate captions
  let semanticGroups = [];
  if (params.semanticEnabled) {
    const captionQueue = [];
    const captionStep = computeProgressStep(totalPosts);
    report('Collecting captions for embeddings…', 0, totalPosts, true);
    for (let i = 0; i < filteredData.length; i++) {
      const post = filteredData[i];
      const userId = post.data?.author?.id;
      const caption = post.data?.desc || '';
      if (userId && caption.length >= 20) {
        captionQueue.push({ userId, caption });
      }

      if ((i + 1) % captionStep === 0 || i + 1 === totalPosts) {
        report('Collecting captions for embeddings…', i + 1, totalPosts);
      }
    }
    report('Collecting captions for embeddings…', totalPosts, totalPosts, true);

    if (captionQueue.length > 0) {
      report('Embedding captions…', 0, captionQueue.length, true);
      await initEmbeddingModel();
      const embeddings = await getEmbeddingsBatch(
        captionQueue.map(item => item.caption),
        {
          onProgress: (current, total) => report('Embedding captions…', current, total),
        }
      );
      const embedArray = captionQueue.map((entry, idx) => ({ ...entry, embedding: embeddings[idx] }));

      const semanticTotal = (embedArray.length * (embedArray.length - 1)) / 2;
      let semanticProcessed = 0;
      const semanticStep = computeProgressStep(semanticTotal);
      report('Comparing caption embeddings…', 0, semanticTotal, true);

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
          semanticProcessed++;
          if (semanticProcessed % semanticStep === 0 || semanticProcessed === semanticTotal) {
            report('Comparing caption embeddings…', semanticProcessed, semanticTotal);
          }
        }
      }
      report('Comparing caption embeddings…', semanticTotal, semanticTotal, true);
      report('Embedding captions…', captionQueue.length, captionQueue.length, true);
    }
  }
  results.indicators.semanticDuplicates = semanticGroups.length;

  // 8) N-gram template captions
  const captionPairs = [];
  const captions = new Map();
  const templateStep = computeProgressStep(totalPosts);
  report('Collecting captions for templates…', 0, totalPosts, true);
  for (let i = 0; i < filteredData.length; i++) {
    const post = filteredData[i];
    const userId = post.data?.author?.id;
    const caption = post.data?.desc || '';
    if (userId && caption.length >= 20) {
      captions.set(userId, caption);
    }

    if ((i + 1) % templateStep === 0 || i + 1 === totalPosts) {
      report('Collecting captions for templates…', i + 1, totalPosts);
    }
  }
  report('Collecting captions for templates…', totalPosts, totalPosts, true);

  const captionArray = Array.from(captions.entries());
  const captionTotal = (captionArray.length * (captionArray.length - 1)) / 2;
  let captionProcessed = 0;
  const captionPairStep = computeProgressStep(captionTotal);
  report('Scanning caption templates…', 0, captionTotal, true);
  for (let i = 0; i < captionArray.length; i++) {
    for (let j = i + 1; j < captionArray.length; j++) {
      const overlap = ngramOverlap(captionArray[i][1], captionArray[j][1]);
      if (overlap >= params.ngramThreshold) {
        captionPairs.push({
          users: [captionArray[i][0], captionArray[j][0]],
          overlap,
        });
        results.suspiciousUsers.add(captionArray[i][0]);
        results.suspiciousUsers.add(captionArray[j][0]);
      }
      captionProcessed++;
      if (captionProcessed % captionPairStep === 0 || captionProcessed === captionTotal) {
        report('Scanning caption templates…', captionProcessed, captionTotal);
      }
    }
  }
  report('Scanning caption templates…', captionTotal, captionTotal, true);
  results.indicators.templateCaptions = captionPairs.length;
  results.indicators.duplicateCaptions = semanticGroups.length + captionPairs.length;

  // 9) Account creation clustering
  report('Clustering account creation dates…', 0, 1, true);
  const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
  report('Clustering account creation dates…', 1, 1, true);
  results.indicators.accountCreationClusters = creationClusters.length;

  // Build user lookup
  const userIdToName = new Map();
  const directoryStep = computeProgressStep(totalPosts);
  report('Preparing user directory…', 0, totalPosts, true);
  for (let i = 0; i < filteredData.length; i++) {
    const post = filteredData[i];
    const author = post.data?.author;
    if (author?.id) {
      userIdToName.set(author.id, author.uniqueId || author.nickname || `user_${author.id}`);
    }

    if ((i + 1) % directoryStep === 0 || i + 1 === totalPosts) {
      report('Preparing user directory…', i + 1, totalPosts);
    }
  }
  report('Preparing user directory…', totalPosts, totalPosts, true);

  const suspiciousList = Array.from(results.suspiciousUsers);
  const suspiciousStep = computeProgressStep(suspiciousList.length);
  report('Scoring suspicious accounts…', 0, suspiciousList.length, true);
  results.userScores = new Map();
  results.userReasons = new Map();

  const burstsByUser = new Map();
  bursts.forEach(burst => {
    if (!burstsByUser.has(burst.userId)) burstsByUser.set(burst.userId, []);
    burstsByUser.get(burst.userId).push(burst);
  });

  suspiciousList.forEach((userId, index) => {
    let score = 0;
    const reasons = [];

    const userSyncGroups = synchGroups.filter(g => g.u1 === userId || g.u2 === userId);
    if (userSyncGroups.length > 0) {
      score += 25;
      const partners = userSyncGroups.map(g => {
        const partnerId = g.u1 === userId ? g.u2 : g.u1;
        return userIdToName.get(partnerId) || partnerId;
      }).slice(0, 5);
      const more = userSyncGroups.length > 5 ? ` and ${userSyncGroups.length - 5} more` : '';
      reasons.push(`Synchronized posting with: ${partners.join(', ')}${more}`);
    }

    const hashtagPartners = [];
    hashtagSequences.forEach(data => {
      if (data.users.has(userId) && data.users.size >= params.minHashtagGroupSize) {
        const others = Array.from(data.users)
          .filter(u => u !== userId)
          .map(u => userIdToName.get(u) || u);
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
      if (users.has(userId) && users.size >= params.minUsernameGroupSize) {
        score += 10;
        const similarUsers = Array.from(users)
          .filter(u => u !== userId)
          .map(u => userIdToName.get(u) || u);
        const display = similarUsers.slice(0, 5);
        const more = similarUsers.length > 5 ? ` and ${similarUsers.length - 5} more` : '';
        reasons.push(`Similar username pattern with: ${display.join(', ')}${more}`);
      }
    });

    const userPostsEntries = postsByUser.get(userId) || [];
    const userPostCount = userPostsEntries.length;
    if (userPostCount >= params.minHighVolumePosts) {
      const zScore = (userPostCount - stats.posts.mean) / (stats.posts.stdDev || 1);
      if (zScore > params.zscoreThreshold) {
        score += 15;
        reasons.push(`High-volume posting (z-score: ${zScore.toFixed(1)})`);
      }
    }

    const userBursts = burstsByUser.get(userId) || [];
    if (userBursts.length > 0) {
      score += 15;
      userBursts.forEach(burst => {
        const timeDesc = timeWindow < 60
          ? `${timeWindow} second${timeWindow !== 1 ? 's' : ''}`
          : `${Math.floor(timeWindow / 60)} minute${Math.floor(timeWindow / 60) !== 1 ? 's' : ''}`;
        reasons.push(`Posting burst: ${burst.count} posts in ${timeDesc}`);
      });
    }

    const rhythm = analyzePostingRhythm(userPostsEntries, params.rhythmCV);
    if (rhythm.regular) {
      score += 20;
      reasons.push(`Highly regular posting rhythm (CV: ${(rhythm.cv * 100).toFixed(1)}%)`);
    }

    const nightPosting = analyzeNightPosting(userPostsEntries, params.nightGap);
    if (nightPosting.suspicious) {
      score += 25;
      reasons.push(`24/7 posting pattern (max gap: ${Math.floor((nightPosting.avgMaxGap || 0) / 3600)}h)`);
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

    const processed = index + 1;
    if (processed % suspiciousStep === 0 || processed === suspiciousList.length) {
      report('Scoring suspicious accounts…', processed, suspiciousList.length);
    }
  });
  report('Scoring suspicious accounts…', suspiciousList.length, suspiciousList.length, true);

  suspiciousList.forEach(userId => {
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

  report('Finalizing results…');

  return {
    suspiciousUsers: Array.from(results.suspiciousUsers),
    indicators: results.indicators,
    userScores: Array.from(results.userScores.entries()),
    userReasons: Array.from(results.userReasons.entries()),
    semanticGroups,
    captionPairs,
    bursts,
  };
}
