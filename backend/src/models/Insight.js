const mongoose = require('mongoose');

const insightSchema = new mongoose.Schema({
  accountId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  username:     { type: String, default: '' },
  igMediaId:    { type: String, required: true, unique: true },
  // IMAGE, VIDEO, CAROUSEL_ALBUM e STORY. STORY nao vem do sync de feed (a
  // borda /media do Graph nunca devolve story) — quem grava e o
  // storyInsightSync, dentro da janela de 24h em que o story existe.
  mediaType:    { type: String, default: 'IMAGE' },
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
  /* Tempo assistido, em ms, só para reels (ig_reels_avg_watch_time e
     ig_reels_video_view_total_time). É a RETENÇÃO — o número que o algoritmo
     usa para decidir se continua distribuindo. null = não veio (mídia que não
     é reel, ou a Graph não respondeu); 0 é um valor real. */
  avgWatchTimeMs:    { type: Number, default: null },
  totalWatchTimeMs:  { type: Number, default: null },
  // Weighted engagement score for ranking
  engagementScore:   { type: Number, default: 0, index: true },
  syncedAt:          { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Insight', insightSchema);
