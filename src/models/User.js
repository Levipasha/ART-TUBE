const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    passwordHash: { type: String, required: true },

    // Profile
    profilePictureUrl: { type: String, default: '' },
    profilePicturePublicId: { type: String, default: '' },

    // Onboarding preferences
    preferredCategories: { type: [String], default: [] }, // ['learn', 'watch']
    preferredLanguage: { type: String, default: '' },
    onboardingCompleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

const User = mongoose.model('User', UserSchema);

module.exports = { User };

