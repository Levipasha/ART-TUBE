const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema(
  {
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    category: { type: String, required: true, enum: ['learn', 'watch'], index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 5000 },

    // YouTube-like metadata
    tags: { type: [String], default: [] },
    madeForKids: { type: Boolean, default: false, index: true },
    visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public', index: true },
    videoCategory: { type: String, default: '' }, // e.g. Education, Gaming, Tech
    language: { type: String, default: '' },
    recordingDate: { type: Date, default: null },
    recordingLocation: { type: String, default: '' },
    thumbnailUrl: { type: String, required: true },
    thumbnailPublicId: { type: String, required: true },
    videoUrl: { type: String, required: true },
    videoPublicId: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { timestamps: true }
);

const Media = mongoose.model('Media', MediaSchema);

module.exports = { Media };

