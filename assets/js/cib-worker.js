// assets/js/cib-worker.js


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
    if (posts.length < 10) return { suspicious: false, avgMaxGap: null };
    const timestamps = posts.map(p => p.timestamp).sort();
    const dailyGaps = new Map();
    timestamps.forEach(ts => {
      const date = new Date(ts * 1000);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!dailyGaps.has(dayKey)) dailyGaps.set(dayKey, []);
      dailyGaps.get(dayKey).push(date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds());
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
    return { suspicious: avgMaxGap < gapThreshold, avgMaxGap };
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
        const nightPosting = analyzeNightPosting(posts, params.nightGap);
        if (nightPosting.suspicious) results.suspiciousUsers.add(userId);
    });

    self.postMessage({ status: 'progress', text: 'Analyzing caption templates...' });
    const captions = new Map();
    filteredData.forEach(p => { if (p.data?.author?.id && p.data.desc) captions.set(p.item_id, { userId: p.data.author.id, desc: p.data.desc }); });
    const captionArray = Array.from(captions.values());
    const captionPairs = [];
    for (let i = 0; i < captionArray.length; i++) {
        for (let j = i + 1; j < captionArray.length; j++) {
            const overlap = ngramOverlap(captionArray[i].desc, captionArray[j].desc);
            if (overlap >= params.ngramThreshold) {
                results.suspiciousUsers.add(captionArray[i].userId).add(captionArray[j].userId);
                captionPairs.push({users: [captionArray[i].userId, captionArray[j].userId], overlap});
            }
        }
    }
    results.indicators.templateCaptions = captionPairs.length;

    self.postMessage({ status: 'progress', text: 'Analyzing account creation...' });
    const creationClusters = detectAccountCreationClusters(filteredData, 86400, params.clusterSize);
    results.indicators.accountCreationClusters = creationClusters.length;
    creationClusters.forEach(cluster => cluster.forEach(userId => results.suspiciousUsers.add(userId)));

    const userIdToName = new Map();
    filteredData.forEach(p => { if(p.data?.author?.id) userIdToName.set(p.data.author.id, p.data.author.uniqueId || p.data.author.nickname || `user_${p.data.author.id}`)});

    results.suspiciousUsers.forEach(userId => {
        let score = 0;
        const reasons = [];

        const userSyncGroups = synchGroups.filter(g => g.u1 === userId || g.u2 === userId);
        if (userSyncGroups.length > 0) {
            score += 25;
            const partners = userSyncGroups.map(g => userIdToName.get(g.u1 === userId ? g.u2 : g.u1) || 'unknown').slice(0, 5);
            reasons.push(`Synchronized posting with: ${partners.join(', ')}`);
        }

        const userHashtagPartners = new Set();
        hashtagSequences.forEach(data => {
            if (data.users.has(userId) && data.users.size >= params.minHashtagGroupSize) {
                data.users.forEach(partnerId => {
                    if (partnerId !== userId) userHashtagPartners.add(userIdToName.get(partnerId) || 'unknown');
                });
            }
        });
        if (userHashtagPartners.size > 0) {
            score += 20;
            reasons.push(`Rare hashtag combinations with: ${[...userHashtagPartners].slice(0, 5).join(', ')}`);
        }

        const userUsernamePartners = new Set();
        usernameGroups.forEach(users => {
            if (users.has(userId) && users.size >= params.minUsernameGroupSize) {
                users.forEach(partnerId => {
                    if (partnerId !== userId) userUsernamePartners.add(userIdToName.get(partnerId) || 'unknown');
                });
            }
        });
        if (userUsernamePartners.size > 0) {
            score += 10;
            reasons.push(`Similar username pattern with: ${[...userUsernamePartners].slice(0, 5).join(', ')}`);
        }

        const userPosts = postsByUser.get(userId) || [];
        if (userPosts.length >= params.minHighVolumePosts) {
            const zScore = (userPosts.length - stats.posts.mean) / (stats.posts.stdDev || 1);
            if (zScore > params.zscoreThreshold) {
                score += 15;
                reasons.push(`High-volume posting (z-score: ${zScore.toFixed(1)})`);
            }
        }

        if (bursts.some(b => b.userId === userId)) { score += 15; reasons.push('Posting burst'); }

        const rhythm = analyzePostingRhythm(userPosts, params.rhythmCV);
        if (rhythm.regular) { score += 20; reasons.push(`Highly regular posting rhythm (CV: ${(rhythm.cv * 100).toFixed(1)}%)`); }

        const nightPosting = analyzeNightPosting(userPosts, params.nightGap);
        if (nightPosting.suspicious) { score += 25; reasons.push(`24/7 posting pattern (max gap: ${Math.floor(nightPosting.avgMaxGap / 3600)}h)`);}

        const templatePartners = new Set();
        captionPairs.forEach(p => {
            if (p.users.includes(userId)) {
                p.users.forEach(u => {
                    if (u !== userId) templatePartners.add(userIdToName.get(u) || 'unknown');
                });
            }
        });
        if (templatePartners.size > 0) {
            score += 20;
            reasons.push(`Template caption with: ${[...templatePartners].slice(0, 5).join(', ')}`);
        }

        creationClusters.forEach(cluster => {
            if (cluster.has(userId)) {
                score += 30;
                reasons.push(`Account created with ${cluster.size - 1} others within 24 hours`);
            }
        });

        if (reasons.length >= 2) score *= (1 + (params.crossMultiplier * (reasons.length - 1)));

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
