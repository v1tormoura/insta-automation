const mongoose = require('mongoose');

const insightSchema = new mongoose.Schema({
  accountId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  username:     { type: String, default: '' },
  igMediaId:    { type: String, required: true, unique: true },
  mediaType:    { type: String, default: 'IMAGE' }, // IMAGE, VIDEO, CAROUSEL_ALBUM
  mediaUrl:     { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  permalink:    { type: String, default: '' },
  caption:      { type: String, default: '' },
  postedAt:     { type: Date, default: null, index: true },
  // Raw metrics
  likeCount:         { type: Number, default: 0 },
  commentsCount:     { type: Number, default: 0 },
  shareCount:        { type: Number, default: 0 },
  savedCount:        { type: Number, default: 0 },
  reach:             { type: Number, default: 0 },
  impressions:       { type: Number, default: 0 },
  videoViews:        { type: Number, default: 0 },
  totalInteractions: { type: Number, default: 0 },
  // Weighted engagement score for ranking
  engagementScore:   { type: Number, default: 0, index: true },
  syncedAt:          { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Insight', insightSchema);
