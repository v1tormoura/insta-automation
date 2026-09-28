'use strict';

/**
 * A publicação no fluxo do Publicador (publicacao.js), contra uma Meta simulada.
 *
 *   reel            → container com video_url (a Meta baixa o arquivo), espera
 *                     FINISHED, media_publish, permalink
 *   story / foto    → video_url | image_url
 *   não pronto      → o media_publish volta a esperar o processamento
 *   resposta perdida→ confere o container antes de publicar de novo (nunca duas vezes)
 *   EXPIRED         → descarta o container e cria outro
 *   erro da conta   → falha na hora, sem nova tentativa
 */

const publicacao = require('../src/services/publicacao');
const { GraphError } = require('../src/services/instagramAPI');

const conta = { id: 'c1', username: 'loja', igUserId: '1784', accessToken: 'TOKEN' };
let chamadas, roteiro;

function responder(corpo, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(corpo) };
}

beforeEach(() => {
  chamadas = [];
  roteiro = { status: ['FINISHED'], publicar: [], containers: 0 };
  publicacao._tempo.esperar = async () => {};
  global.fetch = jest.fn(async (url, opcoes = {}) => {
    const u = String(url);
    const corpo = opcoes.body instanceof URLSearchParams ? Object.fromEntries(opcoes.body) : null;
    chamadas.push({ url: u, metodo: opcoes.method || 'GET', corpo });
    if (u.includes('/media_publish')) {
      const r = roteiro.publicar.shift();
      if (r === 'rede') throw new TypeError('fetch failed');
      if (r) return responder({ error: r }, 400);
      return responder({ id: 'MIDIA_NO_AR' });
    }
    if (/\/1784\/media\?/.test(u)) return responder({ data: [{ id: 'ACHADA', caption: 'oi', timestamp: new Date().toISOString() }] });
    if (u.includes('/1784/media')) {
      if (roteiro.containerFalha) return responder({ error: roteiro.containerFalha }, 400);
      roteiro.containers++;
      return responder({ id: `C${roteiro.containers}` });
    }
    if (/\/C\d+\?/.test(u)) {
      const s = roteiro.status.length > 1 ? roteiro.status.shift() : roteiro.status[0];
      return responder({ status_code: s });
    }
    if (u.includes('/MIDIA_NO_AR?') || u.includes('/ACHADA?')) return responder({ permalink: 'https://instagram.com/reel/x' });
    return responder({ error: { message: 'rota inesperada ' + u } }, 404);
  });
});

const reel = { tipo: 'REEL', midia: { kind: 'video', url: 'https://x/uploads/v.mp4' }, legenda: 'oi', capaUrl: 'https://x/uploads/capa.jpg' };

test('reel: video_url, espera FINISHED, publica e busca o permalink', async () => {
  roteiro.status = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
  const r = await publicacao.publicarNoInstagram(conta, reel);
  expect(r).toEqual({ mediaId: 'MIDIA_NO_AR', permalink: 'https://instagram.com/reel/x' });
  const criar = chamadas[0];
  expect(criar.corpo).toMatchObject({ media_type: 'REELS', video_url: 'https://x/uploads/v.mp4', caption: 'oi', cover_url: 'https://x/uploads/capa.jpg', share_to_feed: 'true' });
  expect(criar.corpo.upload_type).toBeUndefined();
  expect(chamadas.filter(c => /\/C1\?/.test(c.url))).toHaveLength(3);
  expect(chamadas.find(c => c.url.includes('media_publish')).corpo).toMatchObject({ creation_id: 'C1' });
});

test('reel sem capa usa o quadro (thumb_offset)', async () => {
  await publicacao.publicarNoInstagram(conta, { ...reel, capaUrl: null, thumbOffsetMs: 1500 });
  expect(chamadas[0].corpo.thumb_offset).toBe('1500');
  expect(chamadas[0].corpo.cover_url).toBeUndefined();
});

test('story de vídeo e foto do feed', async () => {
  await publicacao.publicarNoInstagram(conta, { tipo: 'STORY', midia: { kind: 'video', url: 'https://x/s.mp4' } });
  expect(chamadas[0].corpo).toMatchObject({ media_type: 'STORIES', video_url: 'https://x/s.mp4' });
  chamadas.length = 0;
  await publicacao.publicarNoInstagram(conta, { tipo: 'IMAGE', midia: { kind: 'image', url: 'https://x/f.jpg' }, legenda: 'l' });
  expect(chamadas[0].corpo).toMatchObject({ image_url: 'https://x/f.jpg', caption: 'l' });
  expect(chamadas[0].corpo.media_type).toBeUndefined();
});

test('"ainda não pronto" no media_publish volta a esperar e publica', async () => {
  roteiro.publicar = [{ message: 'Media is not ready', code: 9007, error_subcode: 2207027 }];
  const r = await publicacao.publicarNoInstagram(conta, reel);
  expect(r.mediaId).toBe('MIDIA_NO_AR');
  expect(chamadas.filter(c => c.url.includes('media_publish'))).toHaveLength(2);
});

test('resposta do media_publish perdida e container PUBLISHED: não publica de novo', async () => {
  roteiro.publicar = ['rede'];
  roteiro.status = ['FINISHED', 'PUBLISHED'];
  const r = await publicacao.publicarNoInstagram(conta, reel);
  expect(r.mediaId).toBe('ACHADA');
  expect(chamadas.filter(c => c.url.includes('media_publish'))).toHaveLength(1);
});

test('container EXPIRED: cria outro e publica', async () => {
  roteiro.status = ['EXPIRED', 'FINISHED'];
  const r = await publicacao.publicarNoInstagram(conta, reel);
  expect(r.mediaId).toBe('MIDIA_NO_AR');
  expect(roteiro.containers).toBe(2);
});

test('erro da conta (token) falha na hora, sem nova tentativa', async () => {
  roteiro.containerFalha = { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 };
  await expect(publicacao.publicarNoInstagram(conta, reel)).rejects.toBeInstanceOf(GraphError);
  expect(roteiro.containers).toBe(0);
  expect(chamadas).toHaveLength(1);
});

test('erro passageiro tenta até 5 vezes', async () => {
  roteiro.containerFalha = { message: 'An unexpected error has occurred', code: 2 };
  await expect(publicacao.publicarNoInstagram(conta, reel)).rejects.toThrow('unexpected');
  expect(chamadas).toHaveLength(publicacao.MAX_TENTATIVAS);
});

test('sem token: recusa antes de chamar a Meta', async () => {
  await expect(publicacao.publicarNoInstagram({ username: 'x' }, reel)).rejects.toMatchObject({ code: 'SEM_TOKEN' });
  expect(chamadas).toHaveLength(0);
});
