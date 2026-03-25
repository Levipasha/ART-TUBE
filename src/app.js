const path = require('path');
const fs = require('fs');

const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

const { authRouter } = require('./routes/auth');
const { channelRouter } = require('./routes/channel');
const { mediaRouter } = require('./routes/media');
const { notificationRouter } = require('./routes/notification');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
// Vercel serverless: project directory is read-only. Use /tmp for any runtime writes.
const uploadsAbsPath = process.env.VERCEL ? path.join('/tmp', UPLOAD_DIR) : path.join(__dirname, '..', UPLOAD_DIR);

function loadDotEnvForLocalDev() {
  // On Vercel, env vars are injected by the platform.
  // Locally, we keep using backend/.env for convenience.
  if (process.env.VERCEL) return;
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
}

function getMongoStoreFactory() {
  return (
    (MongoStore && typeof MongoStore.create === 'function' && MongoStore) ||
    (MongoStore && MongoStore.default && typeof MongoStore.default.create === 'function' && MongoStore.default) ||
    null
  );
}

function buildMissingEnvApp(missingKeys) {
  const app = express();
  app.get('/health', (_req, res) => {
    res.status(500).json({ ok: false, error: 'Missing environment variables', missing: missingKeys });
  });
  app.all('*', (_req, res) => {
    res.status(500).json({ error: 'Server misconfigured', missing: missingKeys });
  });
  return app;
}

async function ensureMongoConnected(mongoUri) {
  if (mongoose.connection?.readyState === 1) return;
  await mongoose.connect(mongoUri);
}

function createExpressApp({ mongoUri, sessionSecret, jwtSecret }) {
  try {
    fs.mkdirSync(uploadsAbsPath, { recursive: true });
  } catch {
    // ignore on platforms where filesystem is restricted
  }

  const app = express();
  app.set('trust proxy', 1);

  app.use(morgan('dev'));
  app.use(cookieParser());
  app.use(
    cors({
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.use((req, _res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      try {
        const payload = jwt.verify(token, jwtSecret);
        if (payload && payload.uid) req.userId = String(payload.uid);
      } catch {
        // ignore invalid token
      }
    }
    next();
  });

  const mongoStoreFactory = getMongoStoreFactory();
  if (!mongoStoreFactory) {
    throw new Error('connect-mongo does not expose create(); reinstall connect-mongo or adjust src/app.js');
  }

  app.use(
    session({
      name: 'arttube.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: mongoStoreFactory.create({
        mongoUrl: mongoUri,
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 14,
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    })
  );

  // Note: Vercel serverless filesystem is not persistent, so `/uploads` is best-effort only.
  // Also, only mount if the directory is accessible.
  try {
    app.use('/uploads', express.static(uploadsAbsPath));
  } catch {
    // ignore
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/channel', channelRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/notifications', notificationRouter);

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

let cached = global.__arttube_cached_app;
if (!cached) {
  cached = global.__arttube_cached_app = { app: null, initPromise: null };
}

async function getApp() {
  if (cached.app) return cached.app;
  if (cached.initPromise) return cached.initPromise;

  cached.initPromise = (async () => {
    loadDotEnvForLocalDev();

    const mongoUri = process.env.MONGODB_URI;
    const sessionSecret = process.env.SESSION_SECRET;
    const jwtSecret = process.env.JWT_SECRET || 'dev-arttube-secret-change-me';

    const missing = [];
    if (!mongoUri) missing.push('MONGODB_URI');
    if (!sessionSecret) missing.push('SESSION_SECRET');
    if (!jwtSecret) missing.push('JWT_SECRET');
    if (missing.length) {
      cached.app = buildMissingEnvApp(missing);
      return cached.app;
    }

    await ensureMongoConnected(mongoUri);
    cached.app = createExpressApp({ mongoUri, sessionSecret, jwtSecret });
    return cached.app;
  })();

  return cached.initPromise;
}

module.exports = { getApp };

