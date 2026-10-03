'use strict';

/** Meta recusa o original (container ERROR): o Reel é refeito no padrão e vai de novo, uma vez. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { FFMPEG_BIN } = require('../src/services/ffmpegBin');
const publicacao = require('../src/services/publicacao');
const { GraphError } = require('../src/services/instagramAPI');
const { publicar } = require('../src/services/publicar');

const UPLOADS = path.resolve(__dirname, '../uploads');
const nome = `teste-recusado-${Date.now()}.mp4`;
const conta = { id: 'c1', username: 'loja', igUserId: '1784', accessToken: 'T', _idConferido: true };

beforeAll(() => {
  execFileSync(FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=540x960', '-f', 'lavfi', '-i', 'sine=d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', path.join(UPLOADS, nome)]);
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: '1784', user_id: '1784' }) }));
});
afterAll(() => fs.rmSync(path.join(UPLOADS, nome), { force: true }));

test('ERROR no original → converte e publica; o refeito é apagado depois', async () => {
  const urls = [];
  const espiao = jest.spyOn(publicacao, 'publicarNoInstagram').mockImplementation(async (c, { midia }) => {
    urls.push(midia.url);
    if (urls.length === 1) throw new GraphError({ message: 'A Meta não conseguiu processar a mídia: ERROR', code: 9 }, 400);
    return { mediaId: 'M1', permalink: null };
  });
  const r = await publicar(conta, { id: 'p1', postType: 'reel', media: nome, caption: 'oi' });
  expect(r.mediaId).toBe('M1');
  expect(urls).toHaveLength(2);
  expect(urls[0]).toContain(nome);
  expect(urls[1]).toMatch(/processed\/.+\.mp4$/);
  const refeito = path.join(UPLOADS, urls[1].slice(urls[1].indexOf('processed/')));
  expect(fs.existsSync(refeito)).toBe(false);
  espiao.mockRestore();
}, 60000);

test('outro erro (token, etc.) não tenta de novo', async () => {
  const espiao = jest.spyOn(publicacao, 'publicarNoInstagram').mockRejectedValue(new GraphError({ message: 'Invalid OAuth access token', code: 190 }, 400));
  await expect(publicar(conta, { id: 'p2', postType: 'reel', media: nome })).rejects.toThrow('Invalid OAuth');
  expect(espiao).toHaveBeenCalledTimes(1);
  espiao.mockRestore();
});
