const mongoose = require('mongoose');

const WatchHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    watchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

WatchHistorySchema.index({ userId: 1, mediaId: 1 }, { unique: true });

const WatchHistory = mongoose.model('WatchHistory', WatchHistorySchema);
module.exports = { WatchHistory };

