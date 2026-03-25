const express = require('express');

const { requireAuth } = require('../middleware/require-auth');
const { Notification } = require('../models/Notification');

const notificationRouter = express.Router();

notificationRouter.get('/me', requireAuth, async (req, res) => {
  const items = await Notification.find({ userId: req.userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const unreadCount = await Notification.countDocuments({ userId: req.userId, readAt: null });
  return res.json({
    unreadCount,
    items: items.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      body: n.body,
      payload: n.payload || {},
      createdAt: n.createdAt,
      readAt: n.readAt,
    })),
  });
});

notificationRouter.post('/:id/read', requireAuth, async (req, res) => {
  const doc = await Notification.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) return res.status(404).json({ error: 'Notification not found' });
  doc.readAt = new Date();
  await doc.save();
  return res.json({ ok: true, readAt: doc.readAt });
});

module.exports = { notificationRouter };
