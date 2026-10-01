'use strict';

/** Importar da própria conta: lista pela API oficial e grava na Biblioteca. */

const fs = require('fs');
const path = require('path');
const banco = require('./helpers/banco');
const { sql } = banco;
const imp = require('../src/services/importarDoInstagram');

const conta = { id: 'c1', username: 'loja', igUserId: '1784', accessToken: 'T' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const gerados = [];

beforeEach(async () => {
  await banco.limpar();
  global.fetch = jest.fn(async url => {
    const u = String(url);
    const json = corpo => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo), arrayBuffer: async () => JPEG });
    if (u.startsWith('https://cdn.test/')) return { ok: true, status: 200, arrayBuffer: async () => JPEG };
    if (u.includes('/1784/media')) return json({
      data: [
        { id: 'A', media_type: 'IMAGE', media_url: 'https://cdn.test/a.jpg', timestamp: '2026-09-20T10:00:00+0000', caption: 'oi' },
        { id: 'B', media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: 'b1', media_type: 'IMAGE', media_url: 'https://cdn.test/b1.jpg' }, { id: 'b2', media_type: 'IMAGE', media_url: 'https://cdn.test/b2.jpg' }] } },
      ],
      paging: { cursors: { after: 'CUR' }, next: 'https://graph/next' },
    });
    if (u.includes('/A?')) return json({ id: 'A', media_type: 'IMAGE', media_url: 'https://cdn.test/a.jpg' });
    if (u.includes('/B?')) return json({ id: 'B', media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: 'b1', media_type: 'IMAGE', media_url: 'https://cdn.test/b1.jpg' }, { id: 'b2', media_type: 'IMAGE', media_url: 'https://cdn.test/b2.jpg' }] } });
    return { ok: false, status: 404, text: async () => '{"error":{"message":"x"}}' };
  });
});
afterAll(async () => {
  for (const g of gerados) fs.rmSync(path.resolve(__dirname, '../uploads', g), { force: true });
  await sql.end();
});

test('lista as publicações da conta, com o cursor da próxima página', async () => {
  const r = await imp.listar(conta);
  expect(r.depois).toBe('CUR');
  expect(r.itens.map(i => [i.id, i.tipo, i.itens])).toEqual([['A', 'IMAGE', 1], ['B', 'CAROUSEL_ALBUM', 2]]);
  expect(String(global.fetch.mock.calls[0][0])).toContain('/1784/media');
});

test('importa foto e carrossel (um arquivo por item) para a Biblioteca', async () => {
  const progresso = [];
  const r = await imp.importar({ usuarioId: banco.DONO_ID, conta, ids: ['A', 'B'], pasta: 'Minhas', aoProgredir: p => progresso.push(p) });
  gerados.push(...r.importados.map(m => m.filename));
  expect(r.erros).toEqual([]);
  expect(r.importados).toHaveLength(3);
  expect(r.importados.every(m => m.folder === 'Minhas' && m.type === 'image')).toBe(true);
  const [{ n }] = await sql`select count(*)::int as n from media where usuario_id = ${banco.DONO_ID}`;
  expect(n).toBe(3);
  expect(progresso.at(-1)).toMatchObject({ feitas: 2, total: 2, importados: 3 });
});

test('sem token: recusa', async () => {
  await expect(imp.listar({ username: 'x' })).rejects.toThrow('não está conectada');
});

test('escala pelo menor lado, sem ampliar', () => {
  expect(imp.escala(720)).toBe("scale='if(gt(iw,ih),-2,min(iw,720))':'if(gt(iw,ih),min(ih,720),-2)'");
});

describe('por URL', () => {
  test('código de publicação do Instagram', () => {
    expect(imp.codigoDoInstagram('https://www.instagram.com/reel/ABC_12-x/?igsh=1')).toBe('ABC_12-x');
    expect(imp.codigoDoInstagram('https://instagram.com/loja/p/XYZ/')).toBe('XYZ');
    expect(imp.codigoDoInstagram('https://cdn.site.com/video.mp4')).toBeNull();
  });

  test('endereços internos são recusados', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1']) expect(imp._ipPrivado(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.1']) expect(imp._ipPrivado(ip)).toBe(false);
  });

  test('página de rede social de terceiros não é aceita', async () => {
    await expect(imp.importarUrl({ usuarioId: banco.DONO_ID, contas: [], url: 'https://www.tiktok.com/@a/video/1' }))
      .rejects.toThrow('não é aceito');
  });

  test('publicação que não é de uma conta conectada é recusada', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: '1', permalink: 'https://www.instagram.com/reel/OUTRO/' }] }) }));
    await expect(imp.importarUrl({ usuarioId: banco.DONO_ID, contas: [conta], url: 'https://www.instagram.com/reel/ABC/' }))
      .rejects.toThrow('não é de nenhuma das suas contas');
  });
});

test('upload + conversão (substituir): o convertido toma o lugar do original', async () => {
  const { execFileSync } = require('child_process');
  const { FFMPEG_BIN } = require('../src/services/ffmpegBin');
  const nome = `teste-substituir-${Date.now()}.png`;
  const arquivo = path.resolve(__dirname, '../uploads', nome);
  execFileSync(FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', arquivo]);
  const { media } = require('../src/repos');
  const original = await media.de(banco.DONO_ID).insert({ filename: nome, originalName: 'foto.png', path: nome, url: `/uploads/${nome}`, mimeType: 'image/png', size: 10, type: 'image', folder: 'Importados' });

  const r = await imp.converterDaBiblioteca({ usuarioId: banco.DONO_ID, ids: [original.id], qualidade: '360', pasta: 'Importados', substituir: true });
  gerados.push(...r.importados.map(m => m.filename));
  expect(r.erros).toEqual([]);
  expect(r.importados[0].originalName).toBe('foto.jpg');
  const linhas = await sql`select id from media where usuario_id = ${banco.DONO_ID}`;
  expect(linhas.map(l => l.id)).toEqual([r.importados[0].id]);
  expect(fs.existsSync(arquivo)).toBe(false);
});

describe('Buscar Reels pela URL do perfil', () => {
  test('lê o @ do link do perfil e recusa link de publicação ou de outra rede', () => {
    expect(imp.usernameDoPerfil('https://www.instagram.com/Loja.X/')).toBe('loja.x');
    expect(imp.usernameDoPerfil('instagram.com/loja/reels/')).toBe('loja');
    expect(imp.usernameDoPerfil('@loja')).toBe('loja');
    expect(imp.usernameDoPerfil('https://www.instagram.com/p/ABC/')).toBeNull();
    expect(imp.usernameDoPerfil('https://tiktok.com/@loja')).toBeNull();
  });

  test('só perfis conectados ao app são acessíveis', () => {
    const contas = [conta, { id: 'c2', username: 'semtoken' }];
    expect(imp.contaDoPerfil(contas, 'https://instagram.com/loja/').conta).toBe(conta);
    expect(imp.contaDoPerfil(contas, 'https://instagram.com/semtoken/').conta).toBeNull();
    expect(imp.contaDoPerfil(contas, 'https://instagram.com/outroperfil/')).toEqual({ nome: 'outroperfil', conta: null });
  });

  test('somenteReels junta páginas e devolve só os Reels', async () => {
    let pagina = 0;
    global.fetch = jest.fn(async () => {
      pagina++;
      const data = pagina === 1
        ? [{ id: 'R1', media_type: 'VIDEO', media_product_type: 'REELS' }, { id: 'F1', media_type: 'IMAGE', media_product_type: 'FEED' }]
        : [{ id: 'R2', media_type: 'VIDEO', media_product_type: 'REELS' }];
      return { ok: true, status: 200, text: async () => JSON.stringify({ data, paging: pagina === 1 ? { cursors: { after: 'P2' }, next: 'x' } : {} }) };
    });
    const r = await imp.listar(conta, { somenteReels: true, limite: 24 });
    expect(r.itens.map(i => i.id)).toEqual(['R1', 'R2']);
    expect(r.depois).toBeNull();
  });
});

describe('Fotos no Importar', () => {
  test("so: 'fotos' traz foto e carrossel, sem os vídeos", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [
      { id: 'R1', media_type: 'VIDEO', media_product_type: 'REELS' },
      { id: 'F1', media_type: 'IMAGE', media_product_type: 'FEED' },
      { id: 'C1', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' },
    ] }) }));
    const r = await imp.listar(conta, { so: 'fotos' });
    expect(r.itens.map(i => i.id)).toEqual(['F1', 'C1']);
  });

  test('foto da Biblioteca convertida para WEBP, com upscale', async () => {
    const { execFileSync } = require('child_process');
    const { FFMPEG_BIN } = require('../src/services/ffmpegBin');
    const nome = `teste-webp-${Date.now()}.png`;
    const arquivo = path.resolve(__dirname, '../uploads', nome);
    gerados.push(nome);
    execFileSync(FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', arquivo]);
    const { media } = require('../src/repos');
    const original = await media.de(banco.DONO_ID).insert({ filename: nome, originalName: 'foto.png', path: nome, url: `/uploads/${nome}`, mimeType: 'image/png', size: 10, type: 'image', folder: 'X' });
    const r = await imp.converterDaBiblioteca({ usuarioId: banco.DONO_ID, ids: [original.id], qualidade: '1080', formato: 'mp3', formatoFoto: 'webp' });
    gerados.push(...r.importados.map(m => m.filename));
    expect(r.erros).toEqual([]);
    expect(r.importados[0]).toMatchObject({ mimeType: 'image/webp', type: 'image' });
    const dim = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.resolve(__dirname, '../uploads', r.importados[0].filename)]).toString().trim();
    expect(dim).toBe('1080,1080');
  });
});

describe('Upscale de foto com IA', () => {
  const comIA = require('../src/services/upscaleIA').disponivel();
  (comIA ? test : test.skip)('foto da Biblioteca restaurada pela IA, no tamanho pedido', async () => {
    const { execFileSync } = require('child_process');
    const { FFMPEG_BIN } = require('../src/services/ffmpegBin');
    const nome = `teste-ia-${Date.now()}.png`;
    const arquivo = path.resolve(__dirname, '../uploads', nome);
    gerados.push(nome);
    execFileSync(FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=96x120', '-frames:v', '1', arquivo]);
    const { media } = require('../src/repos');
    const original = await media.de(banco.DONO_ID).insert({ filename: nome, originalName: 'foto.png', path: nome, url: `/uploads/${nome}`, mimeType: 'image/png', size: 10, type: 'image', folder: 'X' });
    const r = await imp.converterDaBiblioteca({ usuarioId: banco.DONO_ID, ids: [original.id], qualidade: '1080', formatoFoto: 'jpg', ia: 'rapida' });
    gerados.push(...r.importados.map(m => m.filename));
    expect(r.erros).toEqual([]);
    expect(r.importados[0].originalName).toBe('foto (1080p · IA).jpg');
    const dim = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.resolve(__dirname, '../uploads', r.importados[0].filename)]).toString().trim();
    expect(dim).toBe('1080,1350');
  }, 120000);
});
