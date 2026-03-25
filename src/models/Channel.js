const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema(
  {
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 50 },
    handle: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 30, unique: true },

    // YouTube-style channel fields
    profilePictureUrl: { type: String, default: '' },
    profilePicturePublicId: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },
    bannerPublicId: { type: String, default: '' },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    keywords: { type: [String], default: [] },
    country: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    links: {
      type: [
        {
          label: { type: String, default: '' },
          url: { type: String, default: '' },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

const Channel = mongoose.model('Channel', ChannelSchema);

module.exports = { Channel };

