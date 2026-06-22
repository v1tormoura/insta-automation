const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isVideo(file) {
  const name = file.toLowerCase();

  return name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm');
}

function convertToReelFormat(inputPath) {
  return new Promise((resolve, reject) => {
    if (!isVideo(inputPath)) {
      return resolve(inputPath);
    }

    const outputDir = path.resolve(__dirname, '../../uploads/processed');
    ensureDir(outputDir);

    const filename = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${filename}-reel.mp4`);

    ffmpeg(inputPath)
      .outputOptions([
        '-vf',
        'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '44100',
        '-movflags',
        '+faststart',
        '-pix_fmt',
        'yuv420p',
      ])
      .on('end', () => {
        console.log('✅ Vídeo convertido para Reel:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.log('💥 Erro ao converter vídeo:', err.message);
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = {
  convertToReelFormat,
  isVideo,
};
