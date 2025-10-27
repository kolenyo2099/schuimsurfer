export function extractMentionNetwork(posts) {
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

    if (debugCount < 3 && mentions.length > 0) {
      console.log(`Post ${post.item_id}: authorId=${authorId}, ${mentions.length} mentions`, mentions.map(m => `${m.userUniqueId}(${m.userId})`));
      debugCount++;
    }

    mentions.forEach(mention => {
      const mentionId = mention.userId || `user_${mention.userUniqueId}`;
      if (!mentionId || mentionId === 'user_undefined') return;

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

export function extractCoHashtagNetwork(posts) {
  const nodeMap = new Map();
  const linkMap = new Map();

  posts.forEach(post => {
    const hashtags = post.data?.challenges || [];
    hashtags.forEach(tag => {
      const tagId = tag.id;
      if (!nodeMap.has(tagId)) nodeMap.set(tagId, { id: tagId, label: tag.title, count: 0, type: 'hashtag' });
      nodeMap.get(tagId).count++;
    });
    for (let i = 0; i < hashtags.length; i++) {
      for (let j = i + 1; j < hashtags.length; j++) {
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

export function extractUserHashtagNetwork(posts) {
  const nodeMap = new Map();
  const links = [];

  posts.forEach(post => {
    const author = post.data?.author;
    if (!author) return;

    const authorId = `u_${author.id}`;
    if (!nodeMap.has(authorId)) {
      nodeMap.set(authorId, {
        id: authorId,
        label: author.uniqueId || author.nickname,
        type: 'user',
        verified: author.verified,
        followers: post.data?.authorStats?.followerCount || 0
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

export function extractHashtagNetwork(posts) {
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

export function extractPhotoTagNetwork(posts) {
  const nodeMap = new Map();
  const links = [];

  posts.forEach(post => {
    if (post.platform !== 'instagram') return;

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

export function extractLocationNetwork(posts) {
  const nodeMap = new Map();
  const links = [];

  posts.forEach(post => {
    if (post.platform !== 'instagram') return;

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

export function buildNetwork(posts, networkType) {
  switch (networkType) {
    case 'mention':
      return extractMentionNetwork(posts);
    case 'coHashtag':
      return extractCoHashtagNetwork(posts);
    case 'userHashtag':
      return extractUserHashtagNetwork(posts);
    case 'hashtag':
      return extractHashtagNetwork(posts);
    case 'photoTag':
      return extractPhotoTagNetwork(posts);
    case 'location':
      return extractLocationNetwork(posts);
    default:
      return { nodes: [], links: [] };
  }
}

export function calculateNetworkMetrics(graph) {
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

  const avgDegree = (Array.from(degrees.values()).reduce((a, b) => a + b, 0) / n).toFixed(2);
  const maxDegree = degrees.size ? Math.max(...Array.from(degrees.values())) : 0;

  graph.nodes.forEach(node => {
    node.degree = degrees.get(node.id) || 0;
  });

  let totalClustering = 0;
  let validNodes = 0;
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
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (graph.links.some(l => (l.source === arr[i] && l.target === arr[j]) || (l.target === arr[i] && l.source === arr[j]))) {
          triangles++;
        }
      }
    }
    const possible = (k * (k - 1)) / 2;
    if (possible > 0) {
      totalClustering += triangles / possible;
      validNodes++;
    }
  });

  const clustering = validNodes > 0 ? (totalClustering / validNodes).toFixed(3) : '0.000';

  return {
    nodes: n,
    edges: m,
    density,
    avgDegree,
    maxDegree,
    avgClustering: clustering,
  };
}

export function detectCommunities(graph) {
  if (!graph || graph.nodes.length === 0 || graph.links.length === 0) {
    return null;
  }

  const adj = new Map();
  graph.nodes.forEach(n => adj.set(n.id, new Set()));
  graph.links.forEach(l => {
    adj.get(l.source)?.add(l.target);
    adj.get(l.target)?.add(l.source);
  });

  const labels = new Map();
  graph.nodes.forEach((n, i) => labels.set(n.id, i));

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    const shuffled = [...graph.nodes].sort(() => Math.random() - 0.5);
    shuffled.forEach(node => {
      const neighbors = adj.get(node.id);
      if (!neighbors || neighbors.size === 0) return;
      const counts = new Map();
      neighbors.forEach(nb => {
        const lab = labels.get(nb);
        counts.set(lab, (counts.get(lab) || 0) + 1);
      });
      let best = labels.get(node.id);
      let bestCount = 0;
      counts.forEach((c, lab) => {
        if (c > bestCount) {
          bestCount = c;
          best = lab;
        }
      });
      if (best !== labels.get(node.id)) {
        labels.set(node.id, best);
        changed = true;
      }
    });
  }

  const uniq = [...new Set(labels.values())];
  const remap = new Map();
  uniq.forEach((lab, i) => remap.set(lab, i));
  const assignments = new Map();
  labels.forEach((lab, id) => assignments.set(id, remap.get(lab)));

  return { communities: assignments, count: uniq.length };
}
