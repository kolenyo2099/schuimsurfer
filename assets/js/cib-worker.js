// assets/js/cib-worker.js

// Import transformer pipeline directly in the worker
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

// =========================
// Embeddings Logic (from embeddings.js)
// =========================
let extractor = null;

async function initEmbeddingModel() {
  if (!extractor) {
    self.postMessage({ status: 'progress', text: 'Loading AI model (~23MB)...' });
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    self.postMessage({ status: 'progress', text: 'AI model ready.' });
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


// =========================
// Analytics Logic (from analytics.js)
// =========================
function calculateDatasetStatistics(filteredData) {
    const postCounts = new Map();
    const hashtagCounts = new Map();
    filteredData.forEach(post => {
        const userId = post.data?.author?.id;
        if (userId) {
            postCounts.set(userId, (postCounts.get(userId) || 0) + 1);
            const hashtags = post.data?.challenges?.length || 0;
            hashtagCounts.set(userId, (hashtagCounts.get(userId) || 0) + hashtags);
        }
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
    const tf = (userHashtags.filter(h => h === hashtag).length) / (userHashtags.length || 1);
    const idf = Math.log((allHashtags.length) / (allHashtags.filter(set => set.has(hashtag)).length + 1));
    return tf * idf;
}

function getNGrams(text, n = 5) {
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const ngrams = new Set();
    for (let i = 0; i <= words.length - n; i++) {
        ngrams.add(words.slice(i, i + n).join(' '));
    }
    return ngrams;
}

function ngramOverlap(textA, textB, n = 5) {
    const ngramsA = getNGrams(textA, n);
    const ngramsB = getNGrams(textB, n);
    if (ngramsA.size === 0 || ngramsB.size === 0) return 0;
    let intersectionSize = 0;
    ngramsA.forEach(ngram => {
        if (ngramsB.has(ngram)) {
            intersectionSize++;
        }
    });
    return intersectionSize / (ngramsA.size + ngramsB.size - intersectionSize); // Jaccard Index
}

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) { matrix[0][i] = i; }
    for (let j = 0; j <= b.length; j++) { matrix[j][0] = j; }
    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + cost);
        }
    }
    return matrix[b.length][a.length];
}

function analyzePostingRhythm(posts, cvThreshold = 0.1) {
    if (posts.length < 5) return { regular: false };
    const timestamps = posts.map(p => p.timestamp).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
    if (intervals.length === 0) return { regular: false };
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean === 0) return { regular: false };
    const stdDev = Math.sqrt(intervals.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / intervals.length);
    const cv = stdDev / mean;
    return { regular: cv < cvThreshold, cv };
}

function analyzeNightPosting(posts, gapThreshold = 7200) {
    if (posts.length < 10) return { suspicious: false };
    const timestamps = posts.map(p => p.timestamp).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < timestamps.length; i++) {
        maxGap = Math.max(maxGap, timestamps[i] - timestamps[i - 1]);
    }
    return { suspicious: maxGap > gapThreshold, maxGap };
}

function detectAccountCreationClusters(posts, timeWindow = 86400, minClusterSize = 5) {
    const creationTimes = new Map();
    posts.forEach(p => {
        if (p.data?.author?.id && p.data?.author?.createTime) {
            creationTimes.set(p.data.author.id, p.data.author.createTime);
        }
    });
    const sortedAccounts = Array.from(creationTimes.entries()).sort((a, b) => a[1] - b[1]);
    const clusters = [];
    if (sortedAccounts.length === 0) return [];
    let currentCluster = [sortedAccounts[0][0]];
    let clusterStartTime = sortedAccounts[0][1];
    for (let i = 1; i < sortedAccounts.length; i++) {
        const [userId, timestamp] = sortedAccounts[i];
        if (timestamp - clusterStartTime < timeWindow) {
            currentCluster.push(userId);
        } else {
            if (currentCluster.length >= minClusterSize) clusters.push(new Set(currentCluster));
            currentCluster = [userId];
            clusterStartTime = timestamp;
        }
    }
    if (currentCluster.length >= minClusterSize) clusters.push(new Set(currentCluster));
    return clusters;
}

function detectTemporalBursts(postsByUser, timeWindow, minPosts = 5) {
    const bursts = [];
    postsByUser.forEach((posts, userId) => {
        const timestamps = posts.map(p => p.timestamp).sort((a, b) => a - b);
        for (let i = 0; i <= timestamps.length - minPosts; i++) {
            if (timestamps[i + minPosts - 1] - timestamps[i] <= timeWindow) {
                bursts.push({ userId, time: timestamps[i], count: minPosts });
            }
        }
    });
    return bursts;
}

// =========================
// CIB Detection Logic (from app.js)
// =========================
async function detectCIB(filteredData, params, timeWindow) {
    const results = { suspiciousUsers: new Set(), indicators: {}, userScores: new Map(), userReasons: new Map() };
    self.postMessage({ status: 'progress', text: 'Calculating statistics...' });

    if (params.semanticEnabled) {
        await initEmbeddingModel();
    }

    const stats = calculateDatasetStatistics(filteredData);
    const postsByUser = new Map();
    filteredData.forEach(post => {
        const userId = post.data?.author?.id;
        const timestamp = post.data?.createTime;
        if (userId && timestamp) {
            if (!postsByUser.has(userId)) postsByUser.set(userId, []);
            postsByUser.get(userId).push({ timestamp, post });
        }
    });

    self.postMessage({ status: 'progress', text: 'Analyzing synchronized posting...' });
    const userTs = Array.from(postsByUser.entries());
    const synchGroups = [];
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
        }
    }
    results.indicators.synchronized = synchGroups.length;

    self.postMessage({ status: 'progress', text: 'Analyzing hashtag usage...' });
    const userHashtagSets = new Map();
    filteredData.forEach(post => {
        const userId = post.data?.author?.id;
        const hashtags = post.data?.challenges?.map(c => c.title) || [];
        if (userId && hashtags.length) {
            if (!userHashtagSets.has(userId)) userHashtagSets.set(userId, []);
            userHashtagSets.get(userId).push(...hashtags);
        }
    });

    const hashtagSequences = new Map();
    const allSetsForTfidf = Array.from(userHashtagSets.values()).map(arr => new Set(arr));
    userHashtagSets.forEach((hashtags, userId) => {
        const tfidfScore = hashtags.reduce((sum, h) => sum + calculateTFIDF(h, hashtags, allSetsForTfidf), 0) / (hashtags.length || 1);
        if (tfidfScore > params.tfidfThreshold) {
            const key = [...new Set(hashtags)].sort().join(',');
            if (!hashtagSequences.has(key)) hashtagSequences.set(key, { users: new Set(), tfidf: tfidfScore });
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

    self.postMessage({ status: 'progress', text: 'Analyzing usernames...' });
    const usernames = new Map();
    filteredData.forEach(post => {
        const author = post.data?.author;
        if (author?.id && (author.uniqueId || author.nickname)) {
            usernames.set(author.id, author.uniqueId || author.nickname);
        }
    });
    const usernameArray = Array.from(usernames.entries());
    const usernameGroups = new Map();
    for (let i = 0; i < usernameArray.length; i++) {
        for (let j = i + 1; j < usernameArray.length; j++) {
            const [id1, name1] = usernameArray[i];
            const [id2, name2] = usernameArray[j];
            const similarity = 1 - (levenshteinDistance(name1, name2) / Math.max(name1.length, name2.length));
            if (similarity >= params.usernameThreshold) {
                const key = [name1, name2].sort().join('|');
                if (!usernameGroups.has(key)) usernameGroups.set(key, new Set());
                usernameGroups.get(key).add(id1).add(id2);
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

    self.postMessage({ status: 'progress', text: 'Analyzing posting volume...' });
    results.indicators.highVolume = 0;
    postsByUser.forEach((posts, userId) => {
        if (posts.length >= params.minHighVolumePosts) {
            const zScore = (posts.length - stats.posts.mean) / (stats.posts.stdDev || 1);
            if (zScore > params.zscoreThreshold) {
                results.suspiciousUsers.add(userId);
                results.indicators.highVolume++;
            }
        }
    });

    self.postMessage({ status: 'progress', text: 'Detecting temporal bursts...' });
    const bursts = detectTemporalBursts(postsByUser, timeWindow, params.burstPosts);
    results.indicators.temporalBursts = bursts.length;

    postsByUser.forEach((posts, userId) => {
        if (analyzePostingRhythm(posts, params.rhythmCV).regular) results.suspiciousUsers.add(userId);
        if (analyzeNightPosting(posts, params.nightGap).suspicious) results.suspiciousUsers.add(userId);
    });

    let semanticGroups = [];
    if (params.semanticEnabled) {
        self.postMessage({ status: 'progress', text: 'Analyzing caption similarity (AI)...' });
        const captionEmbeddings = new Map();
        for (const post of filteredData) {
            const userId = post.data?.author?.id;
            const caption = post.data?.desc || '';
            if (userId && caption.length >= 20) {
                const embedding = await getEmbedding(caption);
                captionEmbeddings.set(post.item_id, { caption, embedding, userId });
            }
        }
        const embedArray = Array.from(captionEmbeddings.values());
        for (let i = 0; i < embedArray.length; i++) {
            for (let j = i + 1; j < embedArray.length; j++) {
                if (cosineSimilarity(embedArray[i].embedding, embedArray[j].embedding) >= params.semanticThreshold) {
                    results.suspiciousUsers.add(embedArray[i].userId).add(embedArray[j].userId);
                    semanticGroups.push({ users: [embedArray[i].userId, embedArray[j].userId], similarity: cosineSimilarity(embedArray[i].embedding, embedArray[j].embedding) });
                }
            }
        }
    }
    results.indicators.semanticDuplicates = semanticGroups.length;

    self.postMessage({ status: 'progress', text: 'Analyzing caption templates...' });
    const captions = new Map();
    filteredData.forEach(p => { if (p.data?.author?.id && p.data.desc) captions.set(p.item_id, { userId: p.data.author.id, desc: p.data.desc }); });
    const captionArray = Array.from(captions.values());
    let templatePairs = 0;
    for (let i = 0; i < captionArray.length; i++) {
        for (let j = i + 1; j < captionArray.length; j++) {
            if (ngramOverlap(captionArray[i].desc, captionArray[j].desc) >= params.ngramThreshold) {
                results.suspiciousUsers.add(captionArray[i].userId).add(captionArray[j].userId);
                templatePairs++;
            }
        }
    }
    results.indicators.templateCaptions = templatePairs;

    self.postMessage({ status: 'progress', text: 'Analyzing account creation...' });
    const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
    results.indicators.accountCreationClusters = creationClusters.length;
    creationClusters.forEach(cluster => cluster.forEach(userId => results.suspiciousUsers.add(userId)));

    const userIdToName = new Map();
    filteredData.forEach(p => { if(p.data?.author?.id) userIdToName.set(p.data.author.id, p.data.author.uniqueId || p.data.author.nickname || `user_${p.data.author.id}`)});

    results.suspiciousUsers.forEach(userId => {
        let score = 0;
        const reasons = [];
        if (synchGroups.some(g => g.u1 === userId || g.u2 === userId)) { score += 25; reasons.push('Synchronized posting'); }
        if (Array.from(hashtagSequences.values()).some(d => d.users.has(userId) && d.users.size >= params.minHashtagGroupSize)) { score += 20; reasons.push('Rare hashtag combinations'); }
        if (Array.from(usernameGroups.values()).some(u => u.has(userId) && u.size >= params.minUsernameGroupSize)) { score += 10; reasons.push('Similar username pattern'); }
        const userPosts = postsByUser.get(userId) || [];
        if (userPosts.length >= params.minHighVolumePosts && (userPosts.length - stats.posts.mean) / (stats.posts.stdDev || 1) > params.zscoreThreshold) { score += 15; reasons.push('High-volume posting'); }
        if (bursts.some(b => b.userId === userId)) { score += 15; reasons.push('Posting burst'); }
        if (analyzePostingRhythm(userPosts, params.rhythmCV).regular) { score += 20; reasons.push('Highly regular posting rhythm'); }
        if (analyzeNightPosting(userPosts, params.nightGap).suspicious) { score += 25; reasons.push('24/7 posting pattern'); }
        if (semanticGroups.some(g => g.users.includes(userId))) { score += 25; reasons.push('Semantically similar captions'); }
        if (creationClusters.some(c => c.has(userId))) { score += 30; reasons.push('Account creation cluster'); }
        if (reasons.length >= 2) score *= (1 + (params.crossMultiplier * reasons.length));
        results.userScores.set(userId, Math.min(100, Math.round(score)));
        results.userReasons.set(userId, reasons);
    });

    return results;
}


// =========================
// Worker message handler
// =========================
self.onmessage = async (event) => {
    const { filteredData, params, timeWindow } = event.data;
    console.log('CIB worker started.');
    self.postMessage({ status: 'progress', text: 'Starting CIB analysis...' });

    try {
        const results = await detectCIB(filteredData, params, timeWindow);

        // Convert Maps and Sets to Arrays/Objects for serialization
        const serializableResults = {
            ...results,
            suspiciousUsers: Array.from(results.suspiciousUsers),
            userScores: Array.from(results.userScores.entries()),
            userReasons: Array.from(results.userReasons.entries()),
        };

        self.postMessage({ status: 'complete', results: serializableResults });
        console.log('CIB worker finished.');
    } catch (error) {
        console.error('CIB worker error:', error);
        self.postMessage({ status: 'error', error: error.message });
    }
};
