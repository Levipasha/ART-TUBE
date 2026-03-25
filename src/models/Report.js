const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema(
  {
    reporterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, required: true, enum: ['media', 'comment'], index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    details: { type: String, default: '', trim: true, maxlength: 2000 },
    status: { type: String, enum: ['open', 'reviewed', 'closed'], default: 'open', index: true },
  },
  { timestamps: true }
);

ReportSchema.index({ reporterUserId: 1, targetType: 1, targetId: 1, createdAt: -1 });

const Report = mongoose.model('Report', ReportSchema);

module.exports = { Report };
