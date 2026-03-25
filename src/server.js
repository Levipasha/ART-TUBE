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

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { authRouter } = require('./routes/auth');
const { channelRouter } = require('./routes/channel');
const { mediaRouter } = require('./routes/media');
const { notificationRouter } = require('./routes/notification');

const PORT = Number(process.env.PORT || 4000);
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:8081';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-arttube-secret-change-me';

if (!MONGODB_URI) throw new Error('Missing MONGODB_URI in backend/.env');
if (!SESSION_SECRET) throw new Error('Missing SESSION_SECRET in backend/.env');

const uploadsAbsPath = path.join(__dirname, '..', UPLOAD_DIR);
fs.mkdirSync(uploadsAbsPath, { recursive: true });

async function main() {
  await mongoose.connect(MONGODB_URI);

  const app = express();
  app.set('trust proxy', 1);

  app.use(morgan('dev'));
  app.use(cookieParser());
  app.use(
    cors({
      origin: (_origin, callback) => {
        // Allow all origins for dev; required for Expo native apps
        callback(null, true);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  // Attach user from Authorization: Bearer <token> if present
  app.use((req, _res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.uid) {
          req.userId = String(payload.uid);
        }
      } catch {
        // invalid token -> ignore, treat as unauthenticated
      }
    }
    next();
  });

  // connect-mongo export shape differs across versions (CJS/ESM)
  const mongoStoreFactory =
    (MongoStore && typeof MongoStore.create === 'function' && MongoStore) ||
    (MongoStore && MongoStore.default && typeof MongoStore.default.create === 'function' && MongoStore.default) ||
    null;
  if (!mongoStoreFactory) {
    throw new Error(
      'connect-mongo is installed but does not expose create(); please reinstall connect-mongo or update server.js'
    );
  }

  app.use(
    session({
      name: 'arttube.sid',
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: mongoStoreFactory.create({
        mongoUrl: MONGODB_URI,
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 14, // 14 days
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // set true behind https
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    })
  );

  // serve uploaded files
  app.use('/uploads', express.static(uploadsAbsPath));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/channel', channelRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/notifications', notificationRouter);

  // basic error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    console.log(`ARTTUBE backend listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

