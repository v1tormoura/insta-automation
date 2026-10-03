'use strict';

/** O vídeo vai como está só se cabe no padrão do Reels; fora dele, converte. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { FFMPEG_BIN } = require('../src/services/ffmpegBin');
const { motivosParaConverter } = require('../src/services/midiaPorConta');
const traduzirErro = require('../src/utils/traduzirErro');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
const gerar = (nome, extra, fps = 30) => {
  const f = path.join(dir, nome);
  execFileSync(FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=d=1:r=${fps}`, '-f', 'lavfi', '-i', 'sine=d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...extra, f]);
  return f;
};
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test('1080x1920, 30 fps, faststart: vai como está', async () => {
  expect(await motivosParaConverter(gerar('ok.mp4', ['-s', '1080x1920', '-movflags', '+faststart']))).toEqual([]);
});

test('4K, 120 fps e índice no fim: converte', async () => {
  expect((await motivosParaConverter(gerar('4k.mp4', ['-s', '2160x3840', '-movflags', '+faststart'])))[0]).toMatch(/2160x3840/);
  expect(await motivosParaConverter(gerar('120.mp4', ['-s', '540x960', '-movflags', '+faststart'], 120))).toEqual(['120 fps']);
  expect(await motivosParaConverter(gerar('fim.mp4', ['-s', '540x960']))).toEqual(['índice no fim do arquivo']);
}, 60000);

test('erros da Meta em português', () => {
  expect(traduzirErro('Error validating access token: You cannot access the app till you log in to www.instagram.com and follow the instructions given.')).toMatch(/verificação/);
  expect(traduzirErro('A Meta não conseguiu processar a mídia: ERROR')).toMatch(/1920 px/);
}, 60000);
