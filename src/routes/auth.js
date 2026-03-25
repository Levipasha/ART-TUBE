const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { v2: cloudinary } = require('cloudinary');

const { User } = require('../models/User');
const { PasswordResetToken } = require('../models/PasswordResetToken');
const { requireAuth } = require('../middleware/require-auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-arttube-secret-change-me';

const authRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 10 }, // 10MB
});

function uploadBufferToCloudinary({ buffer, folder, publicId, transformation }) {
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

const SignupSchema = z.object({
  username: z.string().trim().min(3).max(30),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  username: z.string().trim().min(3).max(30),
  password: z.string().min(1).max(128),
});
const ForgotPasswordSchema = z.object({
  username: z.string().trim().min(3).max(30),
});
const ResetPasswordSchema = z.object({
  token: z.string().trim().min(10).max(200),
  newPassword: z.string().min(8).max(128),
});
const PreferencesSchema = z.object({
  preferredCategories: z.array(z.enum(['learn', 'watch'])).optional().default([]),
  preferredLanguage: z.string().trim().max(30).optional().default(''),
  onboardingCompleted: z.boolean().optional().default(true),
});

authRouter.post('/signup', async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const { username, password } = parsed.data;
  const existing = await User.findOne({ username }).lean();
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, passwordHash });

  const token = jwt.sign({ uid: user._id }, JWT_SECRET, { expiresIn: '14d' });
  req.session.userId = String(user._id);
  res.status(201).json({ user: { id: String(user._id), username: user.username }, token });
});

authRouter.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const { username, password } = parsed.data;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = String(user._id);
  const token = jwt.sign({ uid: user._id }, JWT_SECRET, { expiresIn: '14d' });
  res.json({ user: { id: String(user._id), username: user.username }, token });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('arttube.sid');
    res.json({ ok: true });
  });
});

authRouter.post('/refresh', (req, res) => {
  const uid = req.userId || req.session?.userId;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '14d' });
  return res.json({ token });
});

authRouter.post('/forgot-password', async (req, res) => {
  const parsed = ForgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const user = await User.findOne({ username: parsed.data.username }).lean();
  // Keep response generic to avoid user enumeration.
  if (!user) return res.json({ ok: true });

  const resetToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes

  await PasswordResetToken.create({
    userId: user._id,
    tokenHash,
    expiresAt,
  });

  // Dev-friendly: return token directly until email integration is added.
  return res.json({ ok: true, resetToken, expiresAt });
});

authRouter.post('/reset-password', async (req, res) => {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const record = await PasswordResetToken.findOne({
    tokenHash,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) return res.status(400).json({ error: 'Invalid or expired token' });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await User.updateOne({ _id: record.userId }, { $set: { passwordHash } });
  record.usedAt = new Date();
  await record.save();

  return res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const id = req.userId || req.session?.userId;
  if (!id) return res.json({ user: null });
  const user = await User.findById(id).lean();
  if (!user) return res.json({ user: null });
  res.json({
    user: {
      id: String(user._id),
      username: user.username,
      profilePictureUrl: user.profilePictureUrl || '',
      preferredCategories: user.preferredCategories || [],
      preferredLanguage: user.preferredLanguage || '',
      onboardingCompleted: Boolean(user.onboardingCompleted),
    },
  });
});

authRouter.get('/preferences', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({
    preferredCategories: user.preferredCategories || [],
    preferredLanguage: user.preferredLanguage || '',
    onboardingCompleted: Boolean(user.onboardingCompleted),
  });
});

authRouter.post('/preferences', requireAuth, async (req, res) => {
  const parsed = PreferencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const nextCategories = Array.from(new Set(parsed.data.preferredCategories));
  await User.updateOne(
    { _id: req.userId },
    {
      $set: {
        preferredCategories: nextCategories,
        preferredLanguage: parsed.data.preferredLanguage || '',
        onboardingCompleted: parsed.data.onboardingCompleted,
      },
    }
  );
  return res.json({
    ok: true,
    preferredCategories: nextCategories,
    preferredLanguage: parsed.data.preferredLanguage || '',
    onboardingCompleted: parsed.data.onboardingCompleted,
  });
});

authRouter.post(
  '/profile-picture',
  requireAuth,
  upload.single('profilePicture'),
  async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'profilePicture is required' });
    if (!file.mimetype?.startsWith('image/')) return res.status(400).json({ error: `Invalid image type: ${file.mimetype}` });

    const folder = process.env.CLOUDINARY_FOLDER ? `${process.env.CLOUDINARY_FOLDER}/user` : 'arttube/user';
    const up = await uploadBufferToCloudinary({
      buffer: file.buffer,
      folder,
      publicId: `${req.userId}-profile`,
      transformation: [{ width: 512, height: 512, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }],
    });

    await User.updateOne(
      { _id: req.userId },
      { $set: { profilePictureUrl: up.secure_url || '', profilePicturePublicId: up.public_id || '' } }
    );

    res.json({ ok: true, profilePictureUrl: up.secure_url || '' });
  }
);

module.exports = { authRouter };

