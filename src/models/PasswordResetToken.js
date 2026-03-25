const mongoose = require('mongoose');

const PasswordResetTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

const PasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);

module.exports = { PasswordResetToken };
