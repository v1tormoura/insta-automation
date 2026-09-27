'use strict';

/**
 * A publicação reescrita (publicacao.js), contra uma Meta simulada.
 *
 *   vídeo           → container resumable, upload direto do arquivo para
 *                     rupload.facebook.com, espera FINISHED, media_publish
 *   upload falhou   → a mesma publicação uma vez pela URL (video_url)
 *   erro da conta   → não tenta de novo (token inválido não melhora pela URL)
 *   imagem          → image_url
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const publicacao = require('../src/services/publicacao');

const conta = { id: 'c1', username: 'loja', igUserId: '1784', accessToken: 'TOKEN' };
let chamadas, roteiro, arquivo;

function responder(corpo, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(corpo) };
}

beforeEach(() => {
  chamadas = [];
  roteiro = {};
  arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pub-')), 'video.mp4');
  fs.writeFileSync(arquivo, Buffer.alloc(2048, 7));
  global.fetch = jest.fn(async (url, opcoes = {}) => {
    const u = String(url);
    const corpo = opcoes.body instanceof URLSearchParams ? Object.fromEntries(opcoes.body) : null;
    let bytes = null;
    if (opcoes.body && !(opcoes.body instanceof URLSearchParams)) {
      bytes = 0; for await (const pedaco of opcoes.body) bytes += pedaco.length;
    }
    chamadas.push({ url: u, metodo: opcoes.method || 'GET', corpo, headers: opcoes.headers || {}, bytes });
    if (u.includes('/media_publish')) return responder({ id: 'MIDIA_NO_AR' });
    if (u.includes('/1784/media')) {
      if (corpo.upload_type === 'resumable') return roteiro.containerFalha ? responder({ error: roteiro.containerFalha }, 400) : responder({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v21.0/C1' });
      return responder({ id: 'C2' });
    }
    if (u.startsWith('https://rupload.facebook.com/')) return roteiro.uploadFalha ? responder({ debug_info: 'falhou' }, 500) : responder({ success: true });
    if (/\/C[12]\?/.test(u)) return responder({ status_code: 'FINISHED' });
    return responder({ error: { message: 'rota inesperada ' + u } }, 404);
  });
});

test('reel: upload direto do arquivo inteiro e publicação', async () => {
  const id = await publicacao.publicarVideo(conta, { tipo: 'REELS', caminho: arquivo, url: 'https://x/uploads/v.mp4', legenda: 'oi', capaUrl: 'https://x/uploads/capa.jpg' });
  expect(id).toBe('MIDIA_NO_AR');
  const [criar, upload, status, publicar] = chamadas;
  expect(criar.corpo).toMatchObject({ media_type: 'REELS', upload_type: 'resumable', caption: 'oi', cover_url: 'https://x/uploads/capa.jpg', share_to_feed: 'true' });
  expect(criar.corpo.video_url).toBeUndefined();
  expect(upload.url).toBe('https://rupload.facebook.com/ig-api-upload/v21.0/C1');
  expect(upload.headers).toMatchObject({ Authorization: 'OAuth TOKEN', offset: '0', file_size: '2048' });
  expect(upload.bytes).toBe(2048);
  expect(status.url).toContain('/C1?');
  expect(publicar.corpo).toMatchObject({ creation_id: 'C1' });
});

test('story em vídeo: resumable sem legenda nem capa', async () => {
  await publicacao.publicarVideo(conta, { tipo: 'STORIES', caminho: arquivo, url: 'https://x/v.mp4' });
  expect(chamadas[0].corpo).toEqual({ media_type: 'STORIES', upload_type: 'resumable', access_token: 'TOKEN' });
});

test('upload direto falhou: publica pela URL', async () => {
  roteiro.uploadFalha = true;
  const id = await publicacao.publicarVideo(conta, { tipo: 'REELS', caminho: arquivo, url: 'https://x/uploads/v.mp4', legenda: 'oi' });
  expect(id).toBe('MIDIA_NO_AR');
  const plano = chamadas.find(c => c.corpo?.video_url);
  expect(plano.corpo).toMatchObject({ media_type: 'REELS', video_url: 'https://x/uploads/v.mp4', caption: 'oi' });
  expect(chamadas.at(-1).corpo).toMatchObject({ creation_id: 'C2' });
});

test('erro da conta (token inválido) não tenta de novo pela URL', async () => {
  roteiro.containerFalha = { message: 'Error validating access token', type: 'OAuthException', code: 190 };
  await expect(publicacao.publicarVideo(conta, { tipo: 'REELS', caminho: arquivo, url: 'https://x/v.mp4' }))
    .rejects.toMatchObject({ code: 190 });
  expect(chamadas.some(c => c.corpo?.video_url)).toBe(false);
});

test('imagem: por URL', async () => {
  const id = await publicacao.publicarImagem(conta, { tipo: 'IMAGE', url: 'https://x/uploads/f.jpg', legenda: 'foto' });
  expect(id).toBe('MIDIA_NO_AR');
  expect(chamadas[0].corpo).toMatchObject({ image_url: 'https://x/uploads/f.jpg', caption: 'foto' });
});

test('conta sem token não chama a Meta', async () => {
  await expect(publicacao.publicarVideo({ username: 'x' }, { tipo: 'REELS', caminho: arquivo })).rejects.toMatchObject({ code: 'SEM_TOKEN' });
  expect(chamadas).toHaveLength(0);
});
