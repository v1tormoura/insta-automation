'use strict';
const { Queue } = require('bullmq');
const connection = require('./connection');

const videoRenderQueue = new Queue('video-renders', { connection });

module.exports = videoRenderQueue;
