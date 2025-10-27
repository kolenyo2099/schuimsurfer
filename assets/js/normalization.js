function detectPlatform(post) {
  const platform = post.source_platform || '';
  if (platform.includes('instagram')) return 'instagram';
  if (platform.includes('tiktok')) return 'tiktok';
  if (platform.includes('twitter') || platform.includes('x.com')) return 'twitter';
  return 'unknown';
}

function extractHashtagsFromText(text) {
  if (!text) return [];
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((tag, idx) => ({
    id: `ig_${tag.substring(1)}_${idx}`,
    title: tag.substring(1)
  }));
}

function extractMentionsFromText(text) {
  if (!text) return [];
  const matches = text.match(/@(\w+)/g) || [];
  return matches.map(mention => ({
    username: mention.substring(1)
  }));
}

export function normalizePost(post) {
  const platform = detectPlatform(post);
  const normalized = { ...post, platform };

  if (platform === 'instagram') {
    const ig = post.data;
    const owner = ig.owner || ig.user || {};
    const caption = ig.caption?.text || '';

    normalized.data = {
      ...ig,
      author: {
        id: owner.pk || owner.id,
        uniqueId: owner.username,
        nickname: owner.full_name || owner.username,
        verified: owner.is_verified || false
      },
      createTime: ig.taken_at,
      desc: caption,
      challenges: extractHashtagsFromText(caption),
      textExtra: extractMentionsFromText(caption).map(m => ({
        type: 0,
        userUniqueId: m.username,
        userId: null
      })),
      stats: {
        diggCount: ig.like_count || 0,
        commentCount: ig.comment_count || 0,
        shareCount: 0,
        playCount: ig.view_count || 0
      },
      authorStats: {
        followerCount: 0
      },
      _instagram: {
        location: ig.location,
        usertags: ig.usertags,
        carousel_media: ig.carousel_media
      }
    };
  } else if (platform === 'tiktok') {
    normalized.data = { ...post.data };
  } else if (platform === 'twitter') {
    const tweet = post.data;
    const userResult = tweet.core?.user_results?.result || {};
    const userCore = userResult.core || {};
    const userLegacy = userResult.legacy || {};
    const tweetLegacy = tweet.legacy || {};

    const parseTwitterDate = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      const timestamp = Math.floor(date.getTime() / 1000);
      if (isNaN(timestamp)) {
        console.warn('Failed to parse Twitter date:', dateStr);
        return null;
      }
      return timestamp;
    };

    const mentions = (tweetLegacy.entities?.user_mentions || []).map(m => ({
      type: 0,
      userUniqueId: m.screen_name,
      userId: m.id_str
    }));

    const hashtags = (tweetLegacy.entities?.hashtags || []).map(h => ({
      id: h.text,
      title: h.text
    }));

    if (mentions.length > 0 || hashtags.length > 0) {
      console.log(`Tweet ${tweet.rest_id}: ${mentions.length} mentions, ${hashtags.length} hashtags`);
    }

    normalized.data = {
      id: tweet.rest_id,
      author: {
        id: userResult.rest_id,
        uniqueId: userCore.screen_name || '',
        nickname: userCore.name || '',
        verified: userResult.is_blue_verified || userResult.verification?.verified || false,
        createTime: parseTwitterDate(userCore.created_at)
      },
      createTime: parseTwitterDate(tweetLegacy.created_at),
      desc: tweetLegacy.full_text || '',
      challenges: hashtags,
      textExtra: mentions,
      stats: {
        diggCount: tweetLegacy.favorite_count || 0,
        commentCount: tweetLegacy.reply_count || 0,
        shareCount: tweetLegacy.retweet_count || 0,
        playCount: parseInt(tweet.views?.count || '0')
      },
      authorStats: {
        followerCount: userLegacy.followers_count || 0,
        followingCount: userLegacy.friends_count || 0,
        heartCount: userLegacy.favourites_count || 0,
        videoCount: userLegacy.statuses_count || 0
      }
    };
  }

  return normalized;
}

export function normalizeRawData(data) {
  return data.map(post => normalizePost(post));
}
