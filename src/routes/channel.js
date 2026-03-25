const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { v2: cloudinary } = require('cloudinary');

const { requireAuth } = require('../middleware/require-auth');
const { Channel } = require('../models/Channel');
const { Subscription } = require('../models/Subscription');
const { Media } = require('../models/Media');
const { User } = require('../models/User');
const { Notification } = require('../models/Notification');

const channelRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 15 }, // 15MB
});

function uploadBufferToCloudinary({ buffer, folder, publicId, mimetype, transformation }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder,
        public_id: publicId,
        overwrite: true,
        use_filename: false,
        unique_filename: false,
        transformation,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    stream.end(buffer);
  });
}

const CreateChannelSchema = z.object({
  name: z.string().trim().min(3).max(50),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_\.]+$/, 'Handle can contain letters, numbers, "_" and "." only'),
});

const ChannelSetupSchema = z.object({
  // allow updating these too
  name: z.string().trim().min(3).max(50).optional(),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_\.]+$/, 'Handle can contain letters, numbers, "_" and "." only')
    .optional(),

  description: z.string().trim().max(2000).optional().default(''),
  keywords: z
    .preprocess((v) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string') return [];
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 25);
    }, z.array(z.string().min(1).max(30)))
    .optional()
    .default([]),
  country: z.string().trim().max(60).optional().default(''),
  contactEmail: z.string().trim().max(120).optional().default(''),
  links: z
    .preprocess((v) => {
      if (typeof v !== 'string') return [];
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }, z.array(z.object({ label: z.string().trim().max(30).default(''), url: z.string().trim().max(300).default('') })))
    .optional()
    .default([]),
});

channelRouter.get('/me', requireAuth, async (req, res) => {
  const ch = await Channel.findOne({ ownerUserId: req.userId }).lean();
  if (!ch) return res.json({ channel: null });
  res.json({
    channel: {
      id: String(ch._id),
      name: ch.name,
      handle: ch.handle,
      description: ch.description || '',
      keywords: ch.keywords || [],
      country: ch.country || '',
      contactEmail: ch.contactEmail || '',
      links: ch.links || [],
      profilePictureUrl: ch.profilePictureUrl || '',
      bannerUrl: ch.bannerUrl || '',
    },
  });
});

channelRouter.post('/create', requireAuth, async (req, res) => {
  const parsed = CreateChannelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const existingMine = await Channel.findOne({ ownerUserId: req.userId }).lean();
  if (existingMine) return res.status(409).json({ error: 'Channel already exists for this user' });

  const handle = parsed.data.handle.toLowerCase();
  const existingHandle = await Channel.findOne({ handle }).lean();
  if (existingHandle) return res.status(409).json({ error: 'Handle already taken' });

  const ch = await Channel.create({
    ownerUserId: req.userId,
    name: parsed.data.name,
    handle,
  });

  res.status(201).json({ id: String(ch._id), name: ch.name, handle: ch.handle });
});

// Full setup (YouTube-like). Accepts multipart form-data.
// Files:
// - profilePicture (optional)
// - banner (optional)
channelRouter.post(
  '/setup',
  requireAuth,
  upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  async (req, res) => {
    const parsed = ChannelSetupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

    const ch = await Channel.findOne({ ownerUserId: req.userId });
    if (!ch) return res.status(400).json({ error: 'Create a channel first' });

    const nextName = parsed.data.name ?? ch.name;
    let nextHandle = parsed.data.handle ? parsed.data.handle.toLowerCase() : ch.handle;
    if (parsed.data.handle && nextHandle !== ch.handle) {
      const existingHandle = await Channel.findOne({ handle: nextHandle }).lean();
      if (existingHandle) return res.status(409).json({ error: 'Handle already taken' });
    }

    const folder = process.env.CLOUDINARY_FOLDER ? `${process.env.CLOUDINARY_FOLDER}/channel` : 'arttube/channel';

    const profilePicture = req.files?.profilePicture?.[0];
    const banner = req.files?.banner?.[0];

    if (profilePicture && !profilePicture.mimetype?.startsWith('image/')) {
      return res.status(400).json({ error: `Invalid profilePicture type: ${profilePicture.mimetype}` });
    }
    if (banner && !banner.mimetype?.startsWith('image/')) {
      return res.status(400).json({ error: `Invalid banner type: ${banner.mimetype}` });
    }

    // Upload images if provided
    if (profilePicture) {
      const up = await uploadBufferToCloudinary({
        buffer: profilePicture.buffer,
        folder,
        publicId: `${ch._id}-profile`,
        mimetype: profilePicture.mimetype,
        transformation: [{ width: 512, height: 512, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }],
      });
      ch.profilePictureUrl = up.secure_url || '';
      ch.profilePicturePublicId = up.public_id || '';
    }
    if (banner) {
      const up = await uploadBufferToCloudinary({
        buffer: banner.buffer,
        folder,
        publicId: `${ch._id}-banner`,
        mimetype: banner.mimetype,
        transformation: [{ width: 2048, height: 512, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }],
      });
      ch.bannerUrl = up.secure_url || '';
      ch.bannerPublicId = up.public_id || '';
    }

    ch.name = nextName;
    ch.handle = nextHandle;
    ch.description = parsed.data.description ?? ch.description ?? '';
    ch.keywords = parsed.data.keywords ?? ch.keywords ?? [];
    ch.country = parsed.data.country ?? ch.country ?? '';
    ch.contactEmail = parsed.data.contactEmail ?? ch.contactEmail ?? '';
    ch.links = parsed.data.links ?? ch.links ?? [];

    await ch.save();
    res.json({
      ok: true,
      channel: {
        id: String(ch._id),
        name: ch.name,
        handle: ch.handle,
        description: ch.description || '',
        keywords: ch.keywords || [],
        country: ch.country || '',
        contactEmail: ch.contactEmail || '',
        links: ch.links || [],
        profilePictureUrl: ch.profilePictureUrl || '',
        bannerUrl: ch.bannerUrl || '',
      },
    });
  }
);

channelRouter.get('/:channelId/preview', async (req, res) => {
  const channelId = req.params.channelId;
  const ch = await Channel.findById(channelId).lean();
  if (!ch) return res.status(404).json({ error: 'Channel not found' });

  const [subscriberCount, videos] = await Promise.all([
    Subscription.countDocuments({ channelId }),
    Media.find({ channelId, visibility: { $in: ['public', 'unlisted'] } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  return res.json({
    channel: {
      id: String(ch._id),
      name: ch.name,
      handle: ch.handle,
      description: ch.description || '',
      profilePictureUrl: ch.profilePictureUrl || '',
      bannerUrl: ch.bannerUrl || '',
      subscriberCount,
      links: ch.links || [],
      country: ch.country || '',
      contactEmail: ch.contactEmail || '',
    },
    videos: videos.map((m) => ({
      id: String(m._id),
      title: m.title,
      description: m.description,
      category: m.category,
      thumbnailUrl: m.thumbnailUrl,
      videoUrl: m.videoUrl,
      createdAt: m.createdAt,
      visibility: m.visibility,
    })),
  });
});

channelRouter.get('/:channelId/subscribers', async (req, res) => {
  const count = await Subscription.countDocuments({ channelId: req.params.channelId });
  res.json({ count });
});

channelRouter.get('/:channelId/subscribed', requireAuth, async (req, res) => {
  const sub = await Subscription.findOne({
    userId: req.userId,
    channelId: req.params.channelId,
  }).lean();
  res.json({ subscribed: !!sub });
});

channelRouter.post('/:channelId/subscribe', requireAuth, async (req, res) => {
  const channelId = req.params.channelId;
  const ch = await Channel.findById(channelId).lean();
  if (!ch) return res.status(404).json({ error: 'Channel not found' });

  const existing = await Subscription.findOne({ userId: req.userId, channelId }).lean();
  if (existing) {
    await Subscription.deleteOne({ userId: req.userId, channelId });
    return res.json({ subscribed: false, count: await Subscription.countDocuments({ channelId }) });
  }
  await Subscription.create({ userId: req.userId, channelId });
  if (String(ch.ownerUserId) !== String(req.userId)) {
    const subscriber = await User.findById(req.userId).select({ username: 1 }).lean();
    await Notification.create({
      userId: ch.ownerUserId,
      type: 'new_subscriber',
      title: 'New subscriber',
      body: `${subscriber?.username || 'Someone'} subscribed to your channel.`,
      payload: { channelId: String(ch._id), subscriberUserId: String(req.userId) },
    });
  }
  const count = await Subscription.countDocuments({ channelId });
  res.json({ subscribed: true, count });
});

module.exports = { channelRouter };

