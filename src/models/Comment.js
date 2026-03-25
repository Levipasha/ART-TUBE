const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema(
  {
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  { timestamps: true }
);

CommentSchema.index({ mediaId: 1, createdAt: -1 });
CommentSchema.index({ parentCommentId: 1, createdAt: -1 });

const Comment = mongoose.model('Comment', CommentSchema);

module.exports = { Comment };
