'use strict';
const mongoose = require('mongoose');

const metaAppSchema = new mongoose.Schema({
  name:               { type: String, required: true, trim: true },
  appId:              { type: String, required: true, trim: true },
  appSecret:          { type: String, required: true, trim: true },
  loginConfigId:      { type: String, default: '', trim: true },
  instagramAppId:     { type: String, default: '', trim: true },
  instagramAppSecret: { type: String, default: '', trim: true },
  isDefault:          { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('MetaApp', metaAppSchema);
