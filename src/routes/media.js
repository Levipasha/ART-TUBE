const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { v2: cloudinary } = require('cloudinary');

const { requireAuth } = require('../middleware/require-auth');
const { Media } = require('../models/Media');
const { Channel } = require('../models/Channel');
const { MediaReaction } = require('../models/MediaReaction');
const { Subscription } = require('../models/Subscription');
const { WatchHistory } = require('../models/WatchHistory');
const { Comment } = require('../models/Comment');
const { CommentReaction } = require('../models/CommentReaction');
const { User } = require('../models/User');
const { Notification } = require('../models/Notification');
const { Report } = require('../models/Report');

const mediaRouter = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'arttube';

mediaRouter.get('/cloudinary-status', async (_req, res) => {
  const configured =
    Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
    Boolean(process.env.CLOUDINARY_API_KEY) &&
    Boolean(process.env.CLOUDINARY_API_SECRET);

  if (!configured) {
    return res.status(500).json({
      ok: false,
      error: 'Cloudinary is not configured on the server',
    });
  }

  try {
    const result = await cloudinary.api.ping();
    return res.json({ ok: true, cloudName: process.env.CLOUDINARY_CLOUD_NAME, ping: result });
  } catch (err) {
    console.error('[media/cloudinary-status] failed', err);
    return res.status(502).json({
      ok: false,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      error: err?.message || String(err),
      name: err?.name,
      http_code: err?.http_code,
    });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 250, // 250MB
  },
});

const UploadMetaSchema = z.object({
  category: z.enum(['learn', 'watch']).default('watch'),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional().default(''),

  // YouTube-like fields (sent as multipart text fields)
  madeForKids: z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v !== 'string') return false;
      return v === 'true' || v === '1' || v.toLowerCase() === 'yes';
    }, z.boolean())
    .optional()
    .default(false),
  visibility: z.enum(['public', 'unlisted', 'private']).optional().default('public'),
  videoCategory: z.string().trim().max(60).optional().default(''),
  language: z.string().trim().max(30).optional().default(''),
  recordingDate: z
    .preprocess((v) => {
      if (typeof v !== 'string') return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }, z.date().nullable())
    .optional()
    .default(null),
  recordingLocation: z.string().trim().max(120).optional().default(''),
  tags: z
    .preprocess((v) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string') return [];
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30);
    }, z.array(z.string().min(1).max(30)))
    .optional()
    .default([]),
});

const CreateCommentSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});
const UpdateMediaSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(5000).optional(),
});
const ReportSchema = z.object({
  reason: z.string().trim().min(2).max(200),
  details: z.string().trim().max(2000).optional().default(''),
});

async function resolveCommentAuthorUserId(req) {
  if (req.userId) return String(req.userId);

  const existingGuestId = req.session?.guestUserId;
  if (existingGuestId) {
    const existingGuest = await User.findById(existingGuestId).select({ _id: 1 }).lean();
    if (existingGuest) return String(existingGuest._id);
  }

  const guestSuffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const guest = await User.create({
    username: `guest_${guestSuffix}`,
    passwordHash: `guest_${guestSuffix}`,
  });
  if (req.session) req.session.guestUserId = String(guest._id);
  return String(guest._id);
}

mediaRouter.get('/', async (req, res) => {
  const category = req.query.category;
  const filter = {};
  if (category === 'learn' || category === 'watch') filter.category = category;

  const items = await Media.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const channelIds = [...new Set(items.map((m) => String(m.channelId)))];
  const channels = channelIds.length
    ? await Channel.find({ _id: { $in: channelIds } }).lean()
    : [];
  const channelById = new Map(channels.map((c) => [String(c._id), c]));

  res.json({
    items: items.map((m) => {
      const ch = channelById.get(String(m.channelId));
      return {
        id: String(m._id),
        title: m.title,
        description: m.description,
        createdAt: m.createdAt,
        category: m.category,
        thumbnailUrl: m.thumbnailUrl,
        videoUrl: m.videoUrl,
        visibility: m.visibility,
        madeForKids: m.madeForKids,
        tags: m.tags,
        channel: ch
          ? {
              id: String(ch._id),
              name: ch.name,
              handle: ch.handle,
              profilePictureUrl: ch.profilePictureUrl || '',
            }
          : null,
      };
    }),
  });
});

mediaRouter.get('/subscribed/me', requireAuth, async (req, res) => {
  const category = req.query.category;
  const videoCategory = typeof req.query.videoCategory === 'string' ? req.query.videoCategory.trim() : '';
  const subs = await Subscription.find({ userId: req.userId }).select({ channelId: 1 }).lean();
  const subscribedChannelIds = subs.map((s) => s.channelId);
  if (!subscribedChannelIds.length) return res.json({ items: [] });

  const filter = { channelId: { $in: subscribedChannelIds }, visibility: 'public' };
  if (category === 'learn' || category === 'watch') filter.category = category;
  if (videoCategory) filter.videoCategory = videoCategory;

  const items = await Media.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const channelIds = [...new Set(items.map((m) => String(m.channelId)))];
  const channels = channelIds.length
    ? await Channel.find({ _id: { $in: channelIds } }).lean()
    : [];
  const channelById = new Map(channels.map((c) => [String(c._id), c]));

  res.json({
    items: items.map((m) => {
      const ch = channelById.get(String(m.channelId));
      return {
        id: String(m._id),
        title: m.title,
        description: m.description,
        createdAt: m.createdAt,
        category: m.category,
        thumbnailUrl: m.thumbnailUrl,
        videoUrl: m.videoUrl,
        visibility: m.visibility,
        madeForKids: m.madeForKids,
        tags: m.tags,
        videoCategory: m.videoCategory,
        channel: ch
          ? {
              id: String(ch._id),
              name: ch.name,
              handle: ch.handle,
              profilePictureUrl: ch.profilePictureUrl || '',
            }
          : null,
      };
    }),
  });
});

mediaRouter.get('/liked/me', requireAuth, async (req, res) => {
  const liked = await MediaReaction.find({ userId: req.userId, type: 'like' })
    .sort({ updatedAt: -1 })
    .limit(30)
    .lean();
  const mediaIds = liked.map((x) => x.mediaId);
  const items = await Media.find({ _id: { $in: mediaIds } }).lean();
  const byId = new Map(items.map((m) => [String(m._id), m]));
  res.json({
    items: mediaIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((m) => ({
        id: String(m._id),
        title: m.title,
        category: m.category,
        thumbnailUrl: m.thumbnailUrl,
        videoUrl: m.videoUrl,
      })),
  });
});

mediaRouter.get('/history/me', requireAuth, async (req, res) => {
  const history = await WatchHistory.find({ userId: req.userId })
    .sort({ watchedAt: -1 })
    .limit(30)
    .lean();
  const mediaIds = history.map((x) => x.mediaId);
  const items = await Media.find({ _id: { $in: mediaIds } }).lean();
  const byId = new Map(items.map((m) => [String(m._id), m]));
  res.json({
    items: mediaIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((m) => ({
        id: String(m._id),
        title: m.title,
        category: m.category,
        thumbnailUrl: m.thumbnailUrl,
        videoUrl: m.videoUrl,
      })),
  });
});

mediaRouter.get('/recommended', async (req, res) => {
  const category = req.query.category;
  const videoCategory = typeof req.query.videoCategory === 'string' ? req.query.videoCategory.trim() : '';
  const filter = {};
  if (category === 'learn' || category === 'watch') filter.category = category;
  if (videoCategory) filter.videoCategory = videoCategory;

  const items = await Media.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  if (!items.length) return res.json({ items: [] });

  const channelIds = [...new Set(items.map((m) => String(m.channelId)))];
  const channels = channelIds.length
    ? await Channel.find({ _id: { $in: channelIds } }).lean()
    : [];
  const channelById = new Map(channels.map((c) => [String(c._id), c]));

  if (!req.userId) {
    return res.json({
      items: items.slice(0, 50).map((m) => {
        const ch = channelById.get(String(m.channelId));
        return {
          id: String(m._id),
          title: m.title,
          description: m.description,
          createdAt: m.createdAt,
          category: m.category,
          thumbnailUrl: m.thumbnailUrl,
          videoUrl: m.videoUrl,
          visibility: m.visibility,
          madeForKids: m.madeForKids,
          tags: m.tags,
          channel: ch
            ? {
                id: String(ch._id),
                name: ch.name,
                handle: ch.handle,
                profilePictureUrl: ch.profilePictureUrl || '',
              }
            : null,
        };
      }),
    });
  }

  const user = await User.findById(req.userId).lean();
  const [history, likes] = await Promise.all([
    WatchHistory.find({ userId: req.userId }).sort({ watchedAt: -1 }).limit(200).lean(),
    MediaReaction.find({ userId: req.userId, type: 'like' }).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const watchedSet = new Set(history.map((h) => String(h.mediaId)));
  const likedSet = new Set(likes.map((l) => String(l.mediaId)));

  const categoryBoost = new Map();
  for (const h of history) {
    const media = items.find((m) => String(m._id) === String(h.mediaId));
    if (!media?.category) continue;
    categoryBoost.set(media.category, (categoryBoost.get(media.category) || 0) + 1);
  }
  const preferredCategories = Array.isArray(user?.preferredCategories) ? user.preferredCategories : [];
  for (const c of preferredCategories) {
    categoryBoost.set(c, (categoryBoost.get(c) || 0) + 3);
  }

  const scored = items.map((m) => {
    let score = 0;
    if (watchedSet.has(String(m._id))) score -= 3;
    if (likedSet.has(String(m._id))) score += 4;
    score += categoryBoost.get(m.category) || 0;
    score += new Date(m.createdAt).getTime() / 10000000000000; // slight recency tie-breaker
    return { media: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 50).map((x) => x.media);

  return res.json({
    items: top.map((m) => {
      const ch = channelById.get(String(m.channelId));
      return {
        id: String(m._id),
        title: m.title,
        description: m.description,
        createdAt: m.createdAt,
        category: m.category,
        thumbnailUrl: m.thumbnailUrl,
        videoUrl: m.videoUrl,
        visibility: m.visibility,
        madeForKids: m.madeForKids,
        tags: m.tags,
        channel: ch
          ? {
              id: String(ch._id),
              name: ch.name,
              handle: ch.handle,
              profilePictureUrl: ch.profilePictureUrl || '',
            }
          : null,
      };
    }),
  });
});

mediaRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json({ items: [] });
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const items = await Media.find({
    $or: [{ title: regex }, { description: regex }, { tags: { $elemMatch: { $regex: regex } } }],
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return res.json({
    items: items.map((m) => ({
      id: String(m._id),
      title: m.title,
      description: m.description,
      category: m.category,
      thumbnailUrl: m.thumbnailUrl,
      createdAt: m.createdAt,
    })),
  });
});

mediaRouter.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json({ suggestions: [] });
  const regex = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const docs = await Media.find({ title: regex }).select({ title: 1 }).sort({ createdAt: -1 }).limit(10).lean();
  const suggestions = Array.from(new Set(docs.map((d) => d.title).filter(Boolean)));
  return res.json({ suggestions });
});

mediaRouter.get('/mine', requireAuth, async (req, res) => {
  const items = await Media.find({ ownerUserId: req.userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const mediaIds = items.map((m) => m._id);
  const [viewsAgg, likesAgg, commentsAgg] = await Promise.all([
    mediaIds.length
      ? WatchHistory.aggregate([
          { $match: { mediaId: { $in: mediaIds } } },
          { $group: { _id: '$mediaId', count: { $sum: 1 } } },
        ])
      : [],
    mediaIds.length
      ? MediaReaction.aggregate([
          { $match: { mediaId: { $in: mediaIds }, type: 'like' } },
          { $group: { _id: '$mediaId', count: { $sum: 1 } } },
        ])
      : [],
    mediaIds.length
      ? Comment.aggregate([
          { $match: { mediaId: { $in: mediaIds }, parentCommentId: null } },
          { $group: { _id: '$mediaId', count: { $sum: 1 } } },
        ])
      : [],
  ]);

  const viewsById = new Map(viewsAgg.map((x) => [String(x._id), x.count]));
  const likesById = new Map(likesAgg.map((x) => [String(x._id), x.count]));
  const commentsById = new Map(commentsAgg.map((x) => [String(x._id), x.count]));

  res.json({
    items: items.map((m) => ({
      id: String(m._id),
      title: m.title,
      description: m.description,
      category: m.category,
      thumbnailUrl: m.thumbnailUrl,
      videoUrl: m.videoUrl,
      visibility: m.visibility,
      createdAt: m.createdAt,
      viewCount: viewsById.get(String(m._id)) || 0,
      likeCount: likesById.get(String(m._id)) || 0,
      commentCount: commentsById.get(String(m._id)) || 0,
    })),
  });
});

mediaRouter.get('/dashboard/me', requireAuth, async (req, res) => {
  const myMedia = await Media.find({ ownerUserId: req.userId }).select({ _id: 1 }).lean();
  const mediaIds = myMedia.map((m) => m._id);

  if (!mediaIds.length) {
    return res.json({
      totals: {
        uploads: 0,
        views: 0,
        likes: 0,
        comments: 0,
      },
    });
  }

  const [views, likes, comments] = await Promise.all([
    WatchHistory.countDocuments({ mediaId: { $in: mediaIds } }),
    MediaReaction.countDocuments({ mediaId: { $in: mediaIds }, type: 'like' }),
    Comment.countDocuments({ mediaId: { $in: mediaIds }, parentCommentId: null }),
  ]);

  res.json({
    totals: {
      uploads: mediaIds.length,
      views,
      likes,
      comments,
    },
  });
});

mediaRouter.get('/:id/comments', async (req, res) => {
  const mediaId = req.params.id;
  const sort = req.query.sort === 'newest' ? 'newest' : 'top';
  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;

  const media = await Media.findById(mediaId).lean();
  if (!media) return res.status(404).json({ error: 'Video not found' });

  const commentDocs = await Comment.find({ mediaId, parentCommentId: null }).lean();
  const commentIds = commentDocs.map((c) => c._id);
  const reactionAgg = commentIds.length
    ? await CommentReaction.aggregate([
        { $match: { commentId: { $in: commentIds } } },
        {
          $group: {
            _id: '$commentId',
            likeCount: { $sum: { $cond: [{ $eq: ['$type', 'like'] }, 1, 0] } },
            dislikeCount: { $sum: { $cond: [{ $eq: ['$type', 'dislike'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const reactionByCommentId = new Map(
    reactionAgg.map((r) => [String(r._id), { likeCount: r.likeCount || 0, dislikeCount: r.dislikeCount || 0 }])
  );

  const sortedComments = [...commentDocs].sort((a, b) => {
    const aLikes = reactionByCommentId.get(String(a._id))?.likeCount || 0;
    const bLikes = reactionByCommentId.get(String(b._id))?.likeCount || 0;
    if (sort === 'top') {
      if (bLikes !== aLikes) return bLikes - aLikes;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const comments = sortedComments.slice(0, limit);

  const userIds = [...new Set(comments.map((c) => String(c.userId)))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }, { username: 1, profilePictureUrl: 1 }).lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const visibleCommentIds = comments.map((c) => c._id);

  let likedByMeIds = new Set();
  let dislikedByMeIds = new Set();
  if (req.userId && visibleCommentIds.length) {
    const myReactions = await CommentReaction.find({
      userId: req.userId,
      commentId: { $in: visibleCommentIds },
    })
      .select({ commentId: 1, type: 1 })
      .lean();
    likedByMeIds = new Set(myReactions.filter((x) => x.type === 'like').map((x) => String(x.commentId)));
    dislikedByMeIds = new Set(myReactions.filter((x) => x.type === 'dislike').map((x) => String(x.commentId)));
  }

  const items = comments.map((c) => {
    const uid = String(c.userId);
    const user = userById.get(uid);
    return {
      id: String(c._id),
      mediaId: String(c.mediaId),
      text: c.text,
      createdAt: c.createdAt,
      author: {
        id: uid,
        name: user?.username || 'User',
        avatarUrl: user?.profilePictureUrl || '',
      },
      likeCount: reactionByCommentId.get(String(c._id))?.likeCount || 0,
      dislikeCount: reactionByCommentId.get(String(c._id))?.dislikeCount || 0,
      likedByMe: likedByMeIds.has(String(c._id)),
      dislikedByMe: dislikedByMeIds.has(String(c._id)),
    };
  });

  res.json({ items });
});

mediaRouter.post('/:id/comments', async (req, res) => {
  const mediaId = req.params.id;
  const media = await Media.findById(mediaId).lean();
  if (!media) return res.status(404).json({ error: 'Video not found' });

  const parsed = CreateCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const authorUserId = await resolveCommentAuthorUserId(req);
  const doc = await Comment.create({
    mediaId,
    userId: authorUserId,
    text: parsed.data.text,
  });

  const user = await User.findById(authorUserId).lean();
  res.status(201).json({
    id: String(doc._id),
    mediaId: String(doc.mediaId),
    text: doc.text,
    createdAt: doc.createdAt,
    author: {
      id: String(authorUserId),
      name: user?.username || 'You',
      avatarUrl: user?.profilePictureUrl || '',
    },
    likeCount: 0,
    dislikeCount: 0,
    likedByMe: false,
    dislikedByMe: false,
  });
});

mediaRouter.post('/comments/:commentId/react', requireAuth, async (req, res) => {
  const commentId = req.params.commentId;
  const type = req.body?.type === 'dislike' ? 'dislike' : 'like';
  const comment = await Comment.findById(commentId).lean();
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const existing = await CommentReaction.findOne({ commentId, userId: req.userId }).lean();

  let currentUserReaction = null;
  if (existing && existing.type === type) {
    await CommentReaction.deleteOne({ _id: existing._id });
  } else {
    await CommentReaction.findOneAndUpdate(
      { commentId, userId: req.userId },
      { $set: { type } },
      { upsert: true }
    );
    currentUserReaction = type;
  }

  const [likeCount, dislikeCount] = await Promise.all([
    CommentReaction.countDocuments({ commentId, type: 'like' }),
    CommentReaction.countDocuments({ commentId, type: 'dislike' }),
  ]);
  res.json({ commentId, currentUserReaction, likedByMe: currentUserReaction === 'like', dislikedByMe: currentUserReaction === 'dislike', likeCount, dislikeCount });
});

mediaRouter.patch(
  '/:id',
  requireAuth,
  upload.single('thumbnail'),
  async (req, res) => {
    const mediaId = req.params.id;
    const media = await Media.findById(mediaId);
    if (!media) return res.status(404).json({ error: 'Video not found' });
    if (String(media.ownerUserId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = UpdateMediaSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    if (typeof parsed.data.title === 'string') media.title = parsed.data.title;
    if (typeof parsed.data.description === 'string') media.description = parsed.data.description;

    const thumbnail = req.file;
    if (thumbnail) {
      if (!thumbnail.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: `Invalid thumbnail type: ${thumbnail.mimetype}` });
      }
      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({ error: 'Cloudinary is not configured on the server' });
      }

      const folder = process.env.CLOUDINARY_FOLDER || 'arttube';
      const up = await uploadBufferToCloudinary({
        buffer: thumbnail.buffer,
        resourceType: 'image',
        folder,
        publicId: `${media._id}-thumb-${Date.now()}`,
        mimetype: thumbnail.mimetype,
      });

      const oldPublicId = media.thumbnailPublicId;
      media.thumbnailUrl = up.secure_url || media.thumbnailUrl;
      media.thumbnailPublicId = up.public_id || media.thumbnailPublicId;
      if (oldPublicId && oldPublicId !== media.thumbnailPublicId) {
        cloudinary.uploader.destroy(oldPublicId, { resource_type: 'image' }).catch(() => {});
      }
    }

    await media.save();
    return res.json({
      id: String(media._id),
      title: media.title,
      description: media.description,
      thumbnailUrl: media.thumbnailUrl,
      visibility: media.visibility,
    });
  }
);

mediaRouter.delete('/:id', requireAuth, async (req, res) => {
  const mediaId = req.params.id;
  const media = await Media.findById(mediaId).lean();
  if (!media) return res.status(404).json({ error: 'Video not found' });
  if (String(media.ownerUserId) !== String(req.userId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const comments = await Comment.find({ mediaId }).select({ _id: 1 }).lean();
  const commentIds = comments.map((c) => c._id);

  await Promise.all([
    Media.deleteOne({ _id: mediaId }),
    MediaReaction.deleteMany({ mediaId }),
    WatchHistory.deleteMany({ mediaId }),
    Comment.deleteMany({ mediaId }),
    commentIds.length ? CommentReaction.deleteMany({ commentId: { $in: commentIds } }) : Promise.resolve(),
  ]);

  if (media.thumbnailPublicId) {
    cloudinary.uploader.destroy(media.thumbnailPublicId, { resource_type: 'image' }).catch(() => {});
  }
  if (media.videoPublicId) {
    cloudinary.uploader.destroy(media.videoPublicId, { resource_type: 'video' }).catch(() => {});
  }

  return res.json({ ok: true });
});

mediaRouter.get('/comments/:commentId/replies', async (req, res) => {
  const parentCommentId = req.params.commentId;
  const parent = await Comment.findById(parentCommentId).lean();
  if (!parent) return res.status(404).json({ error: 'Comment not found' });

  const replies = await Comment.find({ parentCommentId }).sort({ createdAt: -1 }).limit(100).lean();
  const replyIds = replies.map((c) => c._id);
  const userIds = [...new Set(replies.map((c) => String(c.userId)))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }, { username: 1, profilePictureUrl: 1 }).lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const reactionAgg = replyIds.length
    ? await CommentReaction.aggregate([
        { $match: { commentId: { $in: replyIds } } },
        {
          $group: {
            _id: '$commentId',
            likeCount: { $sum: { $cond: [{ $eq: ['$type', 'like'] }, 1, 0] } },
            dislikeCount: { $sum: { $cond: [{ $eq: ['$type', 'dislike'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const reactionByCommentId = new Map(
    reactionAgg.map((r) => [String(r._id), { likeCount: r.likeCount || 0, dislikeCount: r.dislikeCount || 0 }])
  );

  let likedByMeIds = new Set();
  let dislikedByMeIds = new Set();
  if (req.userId && replyIds.length) {
    const myReactions = await CommentReaction.find({
      userId: req.userId,
      commentId: { $in: replyIds },
    })
      .select({ commentId: 1, type: 1 })
      .lean();
    likedByMeIds = new Set(myReactions.filter((x) => x.type === 'like').map((x) => String(x.commentId)));
    dislikedByMeIds = new Set(myReactions.filter((x) => x.type === 'dislike').map((x) => String(x.commentId)));
  }

  const items = replies.map((c) => {
    const uid = String(c.userId);
    const user = userById.get(uid);
    return {
      id: String(c._id),
      mediaId: String(c.mediaId),
      parentCommentId: String(c.parentCommentId),
      text: c.text,
      createdAt: c.createdAt,
      author: {
        id: uid,
        name: user?.username || 'User',
        avatarUrl: user?.profilePictureUrl || '',
      },
      likeCount: reactionByCommentId.get(String(c._id))?.likeCount || 0,
      dislikeCount: reactionByCommentId.get(String(c._id))?.dislikeCount || 0,
      likedByMe: likedByMeIds.has(String(c._id)),
      dislikedByMe: dislikedByMeIds.has(String(c._id)),
    };
  });

  res.json({ items });
});

mediaRouter.post('/comments/:commentId/replies', async (req, res) => {
  const parentCommentId = req.params.commentId;
  const parent = await Comment.findById(parentCommentId).lean();
  if (!parent) return res.status(404).json({ error: 'Comment not found' });

  const parsed = CreateCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const authorUserId = await resolveCommentAuthorUserId(req);
  const doc = await Comment.create({
    mediaId: parent.mediaId,
    parentCommentId: parent._id,
    userId: authorUserId,
    text: parsed.data.text,
  });

  const user = await User.findById(authorUserId).lean();
  if (String(parent.userId) !== String(authorUserId)) {
    await Notification.create({
      userId: parent.userId,
      type: 'comment_reply',
      title: 'New reply',
      body: `${user?.username || 'Someone'} replied to your comment.`,
      payload: { mediaId: String(parent.mediaId), commentId: String(parent._id), replyId: String(doc._id) },
    });
  }
  res.status(201).json({
    id: String(doc._id),
    mediaId: String(doc.mediaId),
    parentCommentId: String(doc.parentCommentId),
    text: doc.text,
    createdAt: doc.createdAt,
    author: {
      id: String(authorUserId),
      name: user?.username || 'You',
      avatarUrl: user?.profilePictureUrl || '',
    },
    likeCount: 0,
    dislikeCount: 0,
    likedByMe: false,
    dislikedByMe: false,
  });
});

mediaRouter.post('/:id/report', requireAuth, async (req, res) => {
  const media = await Media.findById(req.params.id).lean();
  if (!media) return res.status(404).json({ error: 'Video not found' });
  const parsed = ReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const doc = await Report.create({
    reporterUserId: req.userId,
    targetType: 'media',
    targetId: media._id,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  return res.status(201).json({ id: String(doc._id), ok: true });
});

mediaRouter.post('/comments/:commentId/report', requireAuth, async (req, res) => {
  const comment = await Comment.findById(req.params.commentId).lean();
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const parsed = ReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const doc = await Report.create({
    reporterUserId: req.userId,
    targetType: 'comment',
    targetId: comment._id,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  return res.status(201).json({ id: String(doc._id), ok: true });
});

mediaRouter.get('/:id', async (req, res) => {
  const m = await Media.findById(req.params.id).lean();
  if (!m) return res.status(404).json({ error: 'Not found' });

  const channel = await Channel.findById(m.channelId).lean();
  const subscriberCount = channel ? await Subscription.countDocuments({ channelId: m.channelId }) : 0;

  const [likeCount, dislikeCount] = await Promise.all([
    MediaReaction.countDocuments({ mediaId: m._id, type: 'like' }),
    MediaReaction.countDocuments({ mediaId: m._id, type: 'dislike' }),
  ]);

  let channelInfo = null;
  let isSubscribed = false;
  let currentUserReaction = null;
  if (channel) {
    channelInfo = { id: String(channel._id), name: channel.name, handle: channel.handle, profilePictureUrl: channel.profilePictureUrl || '' };
    if (req.userId) {
      const [sub, reaction] = await Promise.all([
        Subscription.findOne({ userId: req.userId, channelId: channel._id }).lean(),
        MediaReaction.findOne({ userId: req.userId, mediaId: m._id }).lean(),
      ]);
      isSubscribed = !!sub;
      currentUserReaction = reaction ? reaction.type : null;
    }
  }

  res.json({
    id: String(m._id),
    title: m.title,
    description: m.description,
    createdAt: m.createdAt,
    category: m.category,
    thumbnailUrl: m.thumbnailUrl,
    videoUrl: m.videoUrl,
    visibility: m.visibility,
    madeForKids: m.madeForKids,
    tags: m.tags,
    videoCategory: m.videoCategory,
    language: m.language,
    recordingDate: m.recordingDate,
    recordingLocation: m.recordingLocation,
    channel: channelInfo,
    subscriberCount,
    likeCount,
    dislikeCount,
    isSubscribed,
    currentUserReaction,
  });
});

mediaRouter.post('/:id/react', requireAuth, async (req, res) => {
  const mediaId = req.params.id;
  const type = req.body?.type === 'like' || req.body?.type === 'dislike' ? req.body.type : null;
  if (!type) return res.status(400).json({ error: 'Body must include type: "like" or "dislike"' });

  const media = await Media.findById(mediaId).lean();
  if (!media) return res.status(404).json({ error: 'Video not found' });

  await MediaReaction.findOneAndUpdate(
    { userId: req.userId, mediaId },
    { $set: { type } },
    { upsert: true }
  );

  const [likeCount, dislikeCount] = await Promise.all([
    MediaReaction.countDocuments({ mediaId, type: 'like' }),
    MediaReaction.countDocuments({ mediaId, type: 'dislike' }),
  ]);
  res.json({ currentUserReaction: type, likeCount, dislikeCount });
});

mediaRouter.post('/:id/view', requireAuth, async (req, res) => {
  const mediaId = req.params.id;
  const exists = await Media.findById(mediaId).lean();
  if (!exists) return res.status(404).json({ error: 'Video not found' });
  await WatchHistory.findOneAndUpdate(
    { userId: req.userId, mediaId },
    { $set: { watchedAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
});

function uploadBufferToCloudinary({ buffer, resourceType, folder, publicId, mimetype }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder,
        public_id: publicId,
        overwrite: false,
        use_filename: false,
        unique_filename: true,
        format: resourceType === 'image' ? undefined : undefined,
        transformation:
          resourceType === 'image'
            ? [{ width: 1280, height: 720, crop: 'limit' }, { quality: 'auto', fetch_format: 'auto' }]
            : undefined,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    stream.end(buffer);
  });
}

mediaRouter.post(
  '/upload',
  requireAuth,
  upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'video', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log('[media/upload] hit', { hasUserId: Boolean(req.userId), contentType: req.headers['content-type'] });
      const parsed = UploadMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      }

      const thumbnail = req.files?.thumbnail?.[0];
      const video = req.files?.video?.[0];

      if (!thumbnail || !video) {
        return res.status(400).json({ error: 'thumbnail and video are required' });
      }

      if (!thumbnail.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: `Invalid thumbnail type: ${thumbnail.mimetype}` });
      }
      if (!video.mimetype?.startsWith('video/')) {
        return res.status(400).json({ error: `Invalid video type: ${video.mimetype}` });
      }

      const channel = await Channel.findOne({ ownerUserId: req.userId }).lean();
      if (!channel) return res.status(400).json({ error: 'Create a channel first' });

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({ error: 'Cloudinary is not configured on the server' });
      }

      const basePublicId = `${channel._id}-${Date.now()}`;

      console.log('[media/upload] start', {
        userId: req.userId,
        channelId: String(channel._id),
        title: parsed.data.title,
        category: parsed.data.category,
        thumbBytes: thumbnail.size,
        videoBytes: video.size,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        folder: CLOUDINARY_FOLDER,
      });

      const [thumbUp, videoUp] = await Promise.all([
        uploadBufferToCloudinary({
          buffer: thumbnail.buffer,
          resourceType: 'image',
          folder: CLOUDINARY_FOLDER,
          publicId: `${basePublicId}-thumb`,
          mimetype: thumbnail.mimetype,
        }),
        uploadBufferToCloudinary({
          buffer: video.buffer,
          resourceType: 'video',
          folder: CLOUDINARY_FOLDER,
          publicId: `${basePublicId}-video`,
          mimetype: video.mimetype,
        }),
      ]);

      console.log('[media/upload] cloudinary ok', {
        thumbPublicId: thumbUp.public_id,
        videoPublicId: videoUp.public_id,
      });

      const doc = await Media.create({
        ownerUserId: req.userId,
        channelId: channel._id,
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
        madeForKids: parsed.data.madeForKids,
        visibility: parsed.data.visibility,
        videoCategory: parsed.data.videoCategory,
        language: parsed.data.language,
        recordingDate: parsed.data.recordingDate,
        recordingLocation: parsed.data.recordingLocation,
        thumbnailUrl: thumbUp.secure_url,
        thumbnailPublicId: thumbUp.public_id,
        videoUrl: videoUp.secure_url,
        videoPublicId: videoUp.public_id,
        mimeType: video.mimetype,
        sizeBytes: video.size,
      });

      res.status(201).json({ id: String(doc._id), thumbnailUrl: doc.thumbnailUrl, videoUrl: doc.videoUrl });
    } catch (err) {
      console.error('[media/upload] failed', err);
      const message =
        err?.message ||
        err?.error?.message ||
        'Upload failed';
      res.status(500).json({
        error: message,
        name: err?.name,
        http_code: err?.http_code,
      });
    }
  }
);

module.exports = { mediaRouter };

