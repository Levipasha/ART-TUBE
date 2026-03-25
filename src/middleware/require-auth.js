function requireAuth(req, res, next) {
  const userId = req.userId || req.session?.userId;
  if (!userId) {
    // Helpful during development to understand why uploads never reach Cloudinary.
    console.warn('[auth] unauthorized', { method: req.method, path: req.originalUrl || req.url });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // normalise on req.userId for downstream handlers
  req.userId = String(userId);
  return next();
}

module.exports = { requireAuth };

