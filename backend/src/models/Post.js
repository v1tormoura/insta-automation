const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    media: {
      type: String,
      required: true,
    },

    cover: {
      type: String,
      default: '',
    },

    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },

    postType: {
      type: String,
      enum: ['post', 'reel', 'story'],
      default: 'post',
    },

    caption: {
      type: String,
      default: '',
    },

    storyLink: {
      type: String,
      default: '',
    },

    storyLinkText: {
      type: String,
      default: '',
    },

    location: {
      type: String,
      default: '',
    },

    accounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],

    scheduledAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      default: 'pendente',
    },

    error: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Post', postSchema);
