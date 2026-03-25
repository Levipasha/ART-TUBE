const mongoose = require('mongoose');

const MediaReactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    type: { type: String, required: true, enum: ['like', 'dislike'] },
  },
  { timestamps: true }
);

MediaReactionSchema.index({ userId: 1, mediaId: 1 }, { unique: true });

const MediaReaction = mongoose.model('MediaReaction', MediaReactionSchema);
module.exports = { MediaReaction };
