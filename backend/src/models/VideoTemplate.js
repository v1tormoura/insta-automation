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

  // Ajuste de imagem, aplicado sobre o quadro já composto.
  //
  // Serve a dois propósitos que costumam andar juntos: corrigir um vídeo escuro
  // ou lavado, e alterar os pixels para o arquivo deixar de ser byte a byte
  // igual ao original.
  //
  // Os valores são -100..100 (0 = sem alteração) para o usuário não precisar
  // saber a escala de cada filtro do ffmpeg, que é diferente para cada um.
  ajustes: {
    enabled:     { type: Boolean, default: false },
    brilho:      { type: Number,  default: 0, min: -100, max: 100 },
    contraste:   { type: Number,  default: 0, min: -100, max: 100 },
    saturacao:   { type: Number,  default: 0, min: -100, max: 100 },
    // 0..100 — sem lado negativo: nitidez e ruído só somam.
    nitidez:     { type: Number,  default: 0, min: 0, max: 100 },
    ruido:       { type: Number,  default: 0, min: 0, max: 100 },
    // Micro-zoom: corta a borda e reescala, mudando o enquadramento de um jeito
    // que praticamente não se nota mas altera todos os pixels.
    zoom:        { type: Number,  default: 0, min: 0, max: 100 },
    espelhar:    { type: Boolean, default: false },
    // Aplica variações mínimas e ALEATÓRIAS a cada render, para dois envios do
    // mesmo vídeo nunca gerarem arquivos idênticos.
    quebrarHash: { type: Boolean, default: false },
  },

  trim: {
    startTime: { type: Number,                         default: 0    },
    endTime:   { type: mongoose.Schema.Types.Mixed,    default: null },
  },

  templatePng: {
    enabled:   { type: Boolean, default: false },
    templates: {
      type: [{
        _id:        false,
        serverPath: { type: String, default: '' },
        name:       { type: String, default: '' },
        url:        { type: String, default: '' },
      }],
      default: [],
    },
    videoX:   { type: Number, default: 0   },
    videoY:   { type: Number, default: 0   },
    videoW:   { type: Number, default: 540 },
    videoH:   { type: Number, default: 960 },
    videoFit: { type: String, default: 'cover' },
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
