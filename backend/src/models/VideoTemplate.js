'use strict';
const mongoose = require('mongoose');

const variableSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  type:         { type: String, enum: ['video', 'image', 'text', 'audio'], default: 'text' },
  label:        { type: String, default: '' },
  required:     { type: Boolean, default: false },
  defaultValue: { type: String, default: '' },
}, { _id: false });

const elementSchema = new mongoose.Schema({
  id:         { type: String, required: true },
  type:       { type: String, enum: ['video', 'image', 'text', 'audio'], required: true },
  label:      { type: String, default: '' },
  source:     { type: String, default: '' },
  text:       { type: String, default: '' },
  x:          { type: Number, default: 0 },
  y:          { type: Number, default: 0 },
  width:      { type: Number, default: 0 },
  height:     { type: Number, default: 0 },
  fit:        { type: String, enum: ['cover', 'contain', 'stretch', 'blur'], default: 'cover' },
  opacity:    { type: Number, default: 1, min: 0, max: 1 },
  fontFamily: { type: String, default: 'Arial' },
  fontSize:   { type: Number, default: 48 },
  fontWeight: { type: String, default: 'normal' },
  color:      { type: String, default: '#FFFFFF' },
  bgColor:    { type: String, default: '' },
  align:      { type: String, enum: ['left', 'center', 'right'], default: 'center' },
  startTime:  { type: Number, default: 0 },
  endTime:    { type: mongoose.Schema.Types.Mixed, default: null },
  zIndex:     { type: Number, default: 0 },
  volume:     { type: Number, default: 1, min: 0, max: 1 },
  fadeIn:     { type: Number, default: 0 },
  fadeOut:    { type: Number, default: 0 },
  loop:       { type: Boolean, default: false },
}, { _id: false });

const videoTemplateSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  thumbnail:   { type: String, default: '' },
  version:     { type: Number, default: 1 },

  canvas: {
    width:      { type: Number, default: 1080 },
    height:     { type: Number, default: 1920 },
    fps:        { type: Number, default: 30 },
    background: { type: String, default: '#000000' },
  },

  output: {
    format:         { type: String, default: 'mp4' },
    videoCodec:     { type: String, default: 'libx264' },
    audioCodec:     { type: String, default: 'aac' },
    crf:            { type: Number, default: 20 },
    preset:         { type: String, enum: ['ultrafast', 'superfast', 'veryfast', 'fast', 'medium', 'slow'], default: 'medium' },
    removeMetadata: { type: Boolean, default: true },
  },

  border: {
    enabled:   { type: Boolean, default: false },
    thickness: { type: Number,  default: 4 },
    color:     { type: String,  default: '#FFFFFF' },
    opacity:   { type: Number,  default: 1.0 },
  },

  trim: {
    startTime: { type: Number,                         default: 0    },
    endTime:   { type: mongoose.Schema.Types.Mixed,    default: null },
  },

  elements:  { type: [elementSchema],  default: [] },
  variables: { type: [variableSchema], default: [] },

  audio: {
    keepOriginal:   { type: Boolean, default: true },
    originalVolume: { type: Number, default: 1.0 },
    musicTrack:     { type: String, default: '' },
    musicVolume:    { type: Number, default: 0.3 },
  },

  usageCount: { type: Number, default: 0 },
  isActive:   { type: Boolean, default: true },
}, { timestamps: true });

videoTemplateSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('VideoTemplate', videoTemplateSchema);
