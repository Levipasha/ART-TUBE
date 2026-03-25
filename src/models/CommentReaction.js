const mongoose = require('mongoose');

const CommentReactionSchema = new mongoose.Schema(
  {
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: ['like', 'dislike'], default: 'like' },
  },
  { timestamps: true }
);

CommentReactionSchema.index({ commentId: 1, userId: 1 }, { unique: true });

const CommentReaction = mongoose.model('CommentReaction', CommentReactionSchema);

module.exports = { CommentReaction };
