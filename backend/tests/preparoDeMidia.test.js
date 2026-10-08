'use strict';

/**
 * Variações de Mídia — com ffmpeg e Postgres de verdade.
 *
 * O que importa aqui:
 *  • o tipo é decidido pelo CONTEÚDO, não pela extensão;
 *  • cada formato escolhido vira uma saída com as dimensões certas, e a foto
 *    do celular (EXIF girado) sai em pé;
 *  • o modo rápido nunca aplica ajuste que a tela não mostra;
 *  • download individual e .zip só do que é da pessoa; outro usuário vê 404;
 *  • cancelar mata o ffmpeg e apaga os arquivos; expirar apaga e mantém o histórico.
 */

process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'senha-do-ambiente';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const banco = require('./helpers/banco');
const { sql } = banco;
const app = require('../src/app');
const senhas = require('../src/services/senhaDoPainel');
const preparo = require('../src/services/preparoDeMidia');
const { _freio } = require('../src/routes/authRoutes');
const { FFMPEG_BIN } = require('../src/services/ffmpegBin');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'preparos-'));
const ff = args => execFileSync(FFMPEG_BIN, ['-v', 'error', '-y', ...args]);

/** JPEG 320×240 com EXIF "girar 90°" (como foto de celular em pé). */
function jpegGirado(destino) {
  const base = path.join(DIR, 'base.jpg');
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1', base]);
  const j = fs.readFileSync(base);
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const corpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (corpo.length + 2) >> 8, (corpo.length + 2) & 255]), corpo]);
  fs.writeFileSync(destino, Buffer.concat([j.subarray(0, 2), app1, j.subarray(2)]));
}

const VIDEO = path.join(DIR, 'clipe.mp4');
const LONGO = path.join(DIR, 'longo.mp4');
const FOTO = path.join(DIR, 'IMG_2415.jpeg');
const FALSO = path.join(DIR, 'falso.mp4');

beforeAll(() => {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', VIDEO]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', LONGO]);
  jpegGirado(FOTO);
  fs.writeFileSync(FALSO, 'isto não é um vídeo');
}, 120_000);
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

describe('peças puras', () => {
  test('tipo pelo conteúdo, não pela extensão', () => {
    expect(preparo.tipoPeloConteudo(fs.readFileSync(VIDEO).subarray(0, 64))).toEqual({ tipo: 'video', ext: 'mp4' });
    expect(preparo.tipoPeloConteudo(fs.readFileSync(FOTO).subarray(0, 64))).toEqual({ tipo: 'imagem', ext: 'jpg' });
    expect(preparo.tipoPeloConteudo(Buffer.from('isto não é um vídeo'))).toBeNull();
  });

  test('orientação EXIF lida do JPEG', () => {
    expect(preparo.orientacaoExif(FOTO)).toBe(6);
    expect(preparo.orientacaoExif(VIDEO)).toBe(1);
  });

  test('modo rápido zera ajustes e trecho; valores fora do limite são cortados', () => {
    const r = preparo.normalizarConfig({ modo: 'rapido', formatos: ['9x16', 'xx'], ajustes: { brilho: 15 }, trecho: { inicio: 3 } });
    expect(r.formatos).toEqual(['9x16']);
    expect(r.ajustes).toEqual({ brilho: 0, contraste: 0, saturacao: 0, nitidez: 0 });
    expect(r.trecho).toEqual({ inicio: 0, fim: null });
    const a = preparo.normalizarConfig(JSON.stringify({ modo: 'avancado', ajustes: { brilho: 99, saturacao: -80 }, formatoFoto: 'exe' }));
    expect(a.ajustes.brilho).toBe(20);
    expect(a.ajustes.saturacao).toBe(-50);
    expect(a.formatoFoto).toBe('jpg');
  });

  test('argumentos: lista separada, sem dados do aparelho, ajuste só quando escolhido', () => {
    const cfg = preparo.normalizarConfig({ formatos: ['4x5'] });
    const args = preparo.argumentos({ entrada: '/x/in.mp4', saida: '/x/out.mp4', config: cfg, formato: '4x5', tipo: 'video', info: {} });
    expect(Array.isArray(args)).toBe(true);
    expect(args.join(' ')).toContain('crop=1080:1350');
    expect(args).toContain('-map_metadata');
    expect(args.join(' ')).not.toContain('eq=');
    const comAjuste = preparo.normalizarConfig({ modo: 'avancado', ajustes: { brilho: 10 } });
    expect(preparo.argumentos({ entrada: 'a', saida: 'b', config: comAjuste, formato: '9x16', tipo: 'video' }).join(' ')).toContain('eq=brightness=0.100');
  });
});

describe('API', () => {
  let servidor, BASE;
  beforeAll(async () => {
    servidor = app.listen(0);
    await new Promise(r => servidor.once('listening', r));
    BASE = `http://127.0.0.1:${servidor.address().port}`;
  });
  afterAll(() => new Promise(r => servidor.close(r)));
  beforeEach(async () => {
    await banco.limpar();
    _freio.erros.clear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  async function api(metodo, rota, { token, corpo, cru = false } = {}) {
    const r = await fetch(BASE + rota, {
      method: metodo,
      headers: { ...(corpo && !(corpo instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: corpo === undefined ? undefined : corpo instanceof FormData ? corpo : JSON.stringify(corpo),
    });
    if (cru) return r;
    const texto = await r.text();
    let dados; try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: r.status, dados };
  }

  const criados = [];
  afterAll(() => { for (const id of criados) fs.rmSync(path.join(preparo.PASTA, id), { recursive: true, force: true }); });

  async function usuario(nome) {
    const email = `${nome}@teste.com`;
    const u = await banco.criarUsuario({ nome, email, senhaHash: senhas.gerar('senha-boa-123'), status: 'ativo' });
    criados.push(u.id);
    return (await api('POST', '/auth/login', { corpo: { username: email, password: 'senha-boa-123' } })).dados.token;
  }

  function enviar(token, arquivo, config, lote) {
    const fd = new FormData();
    fd.append('config', JSON.stringify(config));
    if (lote) fd.append('lote', lote);
    fd.append('arquivo', new Blob([fs.readFileSync(arquivo)]), path.basename(arquivo));
    return api('POST', '/preparos/arquivos', { token, corpo: fd });
  }

  const dims = arquivo => execFileSync(FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', arquivo]).toString().trim();

  test('vídeo: uma saída por formato, nas dimensões certas, e o original é apagado', async () => {
    const token = await usuario('ana');
    const r = await enviar(token, VIDEO, { formatos: ['9x16', '1x1'], enquadramento: 'desfoque', qualidade: 'leve' });
    expect(r.status).toBe(201);
    expect(r.dados.item.tipo).toBe('video');
    const id = r.dados.item.id;
    const [fila] = await sql`select count(*)::int as n from queue_jobs where name = 'preparo_midia' and data->>'id' = ${id}`;
    expect(fila.n).toBe(1);

    await preparo.processar({ id });
    const lista = await api('GET', '/preparos', { token });
    const item = lista.dados.itens[0];
    expect(item.status).toBe('concluido');
    expect(item.saidas.map(s => `${s.formato}:${s.largura}x${s.altura}`)).toEqual(['9x16:1080x1920', '1x1:1080x1080']);
    expect(item.saidas[0].nome).toBe('clipe - 9x16.mp4');
    expect(item.saidas.every(s => s.miniatura)).toBe(true);
    expect(lista.dados.ultimoLote.saidas).toHaveLength(2);
    const pasta = path.join(preparo.PASTA, (await sql`select usuario_id from preparos_de_midia where id = ${id}`)[0].usuarioId, id);
    expect(fs.readdirSync(pasta).some(n => n.startsWith('original.'))).toBe(false);

    const baixar = await api('GET', `/preparos/saidas/${item.saidas[0].id}`, { token, cru: true });
    expect(baixar.status).toBe(200);
    expect(baixar.headers.get('content-disposition')).toContain('clipe - 9x16.mp4');
    const destino = path.join(DIR, 'baixado.mp4');
    fs.writeFileSync(destino, Buffer.from(await baixar.arrayBuffer()));
    expect(dims(destino)).toBe('1080,1920');
    expect((await api('GET', '/preparos', { token })).dados.itens[0].saidas[0].baixadoEm).toBeTruthy();
  }, 120_000);

  test('foto de celular (EXIF girado) sai em pé; formato de foto e ajuste do modo avançado', async () => {
    const token = await usuario('bia');
    const r = await enviar(token, FOTO, { modo: 'avancado', formatos: ['original'], formatoFoto: 'webp', ajustes: { saturacao: 20 } });
    expect(r.status).toBe(201);
    await preparo.processar({ id: r.dados.item.id });
    const [item] = (await api('GET', '/preparos', { token })).dados.itens;
    expect(item.saidas[0]).toMatchObject({ ext: 'webp', largura: 240, altura: 320, nome: 'IMG_2415 - original.webp' });
  }, 60_000);

  test('trecho do vídeo e sem áudio (modo avançado)', async () => {
    const token = await usuario('hugo');
    const r = await enviar(token, VIDEO, { modo: 'avancado', formatos: ['original'], larguraOriginal: 0, semAudio: true, trecho: { inicio: 0.5, fim: 1.5 } });
    await preparo.processar({ id: r.dados.item.id });
    const [item] = (await api('GET', '/preparos', { token })).dados.itens;
    expect(item.saidas[0]).toMatchObject({ largura: 640, altura: 360 });
    expect(item.saidas[0].duracao).toBeGreaterThan(0.8);
    expect(item.saidas[0].duracao).toBeLessThan(1.2);
    const s = await preparo.saidaDoUsuario((await sql`select usuario_id from preparos_de_midia where id = ${item.id}`)[0].usuarioId, item.saidas[0].id);
    const streams = execFileSync(FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', s.caminho]).toString().trim();
    expect(streams).toBe('video');
  }, 60_000);

  test('arquivo falso, tipo fora do filtro e sem login são recusados', async () => {
    const token = await usuario('caio');
    const falso = await enviar(token, FALSO, { formatos: ['9x16'] });
    expect(falso.status).toBe(422);
    expect(falso.dados.error).toMatch(/Formato não suportado/);
    const soVideo = await enviar(token, FOTO, { formatos: ['9x16'], aplicarEm: 'video' });
    expect(soVideo.status).toBe(422);
    expect((await enviar(null, VIDEO, {})).status).toBe(401);
    expect(fs.readdirSync(path.resolve(__dirname, '../uploads/tmp/preparos')).length).toBe(0);
  });

  test('.zip com as saídas escolhidas; outro usuário não baixa nem exclui', async () => {
    const dono = await usuario('davi');
    const outro = await usuario('eva');
    const r1 = await enviar(dono, FOTO, { formatos: ['9x16', '4x5', '1x1'] });
    await preparo.processar({ id: r1.dados.item.id });
    const [item] = (await api('GET', '/preparos', { token: dono })).dados.itens;
    const ids = item.saidas.map(s => s.id);

    expect((await api('GET', `/preparos/saidas/${ids[0]}`, { token: outro })).status).toBe(404);
    expect((await api('POST', '/preparos/zip', { token: outro, corpo: { saidas: ids } })).status).toBe(404);
    expect((await api('DELETE', '/preparos', { token: outro, corpo: { ids: [item.id] } })).dados.excluidos).toBe(0);
    expect((await api('GET', '/preparos', { token: outro })).dados.itens).toHaveLength(0);

    const pedido = await api('POST', '/preparos/zip', { token: dono, corpo: { saidas: ids } });
    expect(pedido.dados.arquivos).toBe(3);
    expect((await api('GET', pedido.dados.url, { token: outro })).status).toBe(404);
    const zip = Buffer.from(await (await api('GET', pedido.dados.url, { token: dono, cru: true })).arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(zip.readUInt16LE(fim + 10)).toBe(3);
    expect(zip.includes(Buffer.from('IMG_2415 - 4x5.jpg'))).toBe(true);

    expect((await api('DELETE', '/preparos', { token: dono, corpo: { ids: [item.id] } })).dados.excluidos).toBe(1);
    expect((await api('GET', `/preparos/saidas/${ids[0]}`, { token: dono })).status).toBe(404);
  }, 60_000);

  test('cancelar no meio mata o ffmpeg e apaga tudo', async () => {
    const token = await usuario('fabi');
    const r = await enviar(token, LONGO, { formatos: ['9x16', '4x5', '1x1'], enquadramento: 'desfoque', qualidade: 'alta' });
    const id = r.dados.item.id;
    const rodando = preparo.processar({ id });
    for (let i = 0; i < 50 && (await preparo.porId(id)).status !== 'processando'; i++) await new Promise(x => setTimeout(x, 50));
    await new Promise(x => setTimeout(x, 400));
    const inicio = Date.now();
    expect((await api('POST', '/preparos/cancelar', { token, corpo: { ids: [id] } })).dados.cancelados).toBe(1);
    await rodando;
    expect(Date.now() - inicio).toBeLessThan(5000);
    const final = await preparo.porId(id);
    expect(final.status).toBe('cancelado');
    expect(fs.existsSync(path.join(preparo.PASTA, final.usuarioId, id))).toBe(false);
  }, 60_000);

  test('expirar apaga os arquivos e mantém a linha no histórico', async () => {
    const token = await usuario('gil');
    const r = await enviar(token, FOTO, { formatos: ['1x1'] });
    const id = r.dados.item.id;
    await preparo.processar({ id });
    const [item] = (await api('GET', '/preparos', { token })).dados.itens;
    await sql`update preparos_de_midia set expira_em = now() - interval '1 minute' where id = ${id}`;
    const resumo = await preparo.limpar();
    expect(resumo.expirados).toBe(1);
    expect((await api('GET', `/preparos/saidas/${item.saidas[0].id}`, { token })).status).toBe(404);
    expect((await api('GET', '/preparos', { token })).dados.itens).toHaveLength(0);
    const hist = await api('GET', '/preparos/historico', { token });
    expect(hist.dados.lotes[0]).toMatchObject({ arquivos: 1, expirados: 1 });
  }, 60_000);

  test('a pasta dos resultados não é pública em /uploads', async () => {
    expect((await api('GET', '/uploads/preparos/qualquer/coisa.mp4', {})).status).toBe(404);
  });
});
