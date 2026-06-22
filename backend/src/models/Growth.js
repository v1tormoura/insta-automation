const mongoose = require('mongoose');

const growthSchema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    username: String,

    followers: Number,
    following: Number,
    postsCount: Number,

    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Growth', growthSchema);
