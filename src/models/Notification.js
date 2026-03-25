const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: ['comment_reply', 'new_subscriber'], index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: '', trim: true, maxlength: 1000 },
    payload: { type: Object, default: {} },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', NotificationSchema);

module.exports = { Notification };
