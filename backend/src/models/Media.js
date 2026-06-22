const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    path: String,
    url: String,
    mimeType: String,
    size: Number,
    type: {
      type: String,
      enum: ['image', 'video', 'other'],
      default: 'other',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Media', mediaSchema);
