'use strict';

/**
 * Edições das Variações e do Postar: corte de silêncios, capa e logo.
 * Com ffmpeg e Postgres de verdade.
 *
 *  • o corte tira as pausas conhecidas e mantém a fala (duração confere);
 *  • a capa sai 1080×1920 com o título;
 *  • o logo aparece no canto escolhido (cor medida no pixel);
 *  • o arquivo do logo nunca vem da tela, e quem não tem logo segue sem;
 *  • "Mandar para a Biblioteca" cria a mídia na pasta Variações.
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
const marca = require('../src/services/marcaDagua');
const logoDoUsuario = require('../src/services/logoDoUsuario');
const { _freio } = require('../src/routes/authRoutes');
const { FFMPEG_BIN } = require('../src/services/ffmpegBin');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'edicoes-'));
const ff = args => execFileSync(FFMPEG_BIN, ['-v', 'error', '-y', ...args]);
const FALA = path.join(DIR, 'fala.mp4');   // 6 s, mudo em 1–2,5 s e 4–5 s
const PRETO = path.join(DIR, 'preto.png'); // 1080×1920 preto
const LOGO = path.join(DIR, 'logo.png');   // vermelho

beforeAll(() => {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100',
    '-t', '6', '-af', "volume=enable='between(t,1,2.5)+between(t,4,5)':volume=0",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', FALA]);
  ff(['-f', 'lavfi', '-i', 'color=black:size=1080x1920', '-frames:v', '1', PRETO]);
  ff(['-f', 'lavfi', '-i', 'color=red:size=200x200', '-frames:v', '1', LOGO]);
}, 60_000);
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

/** Cor média (r, g, b) de um quadrado da imagem. */
function cor(arquivo, x, y, lado = 20) {
  const buf = execFileSync(FFMPEG_BIN, ['-v', 'error', '-i', arquivo, '-vf', `crop=${lado}:${lado}:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [...buf.subarray(0, 3)];
}
const sondar = arq => preparo.sondar(arq);

describe('corte de silêncios — peças', () => {
  test('lê as pausas do silencedetect, inclusive a que vai até o fim', () => {
    const saida = '[silencedetect @ 0x1] silence_start: 1.02\n[silencedetect @ 0x1] silence_end: 2.48 | silence_duration: 1.46\n[silencedetect @ 0x1] silence_start: 5.5\n';
    expect(preparo.lerSilencios(saida, 6)).toEqual([{ inicio: 1.02, fim: 2.48 }, { inicio: 5.5, fim: 6 }]);
  });

  test('o que fica: pausas com folga dos dois lados; pouca pausa não corta', () => {
    const r = preparo.trechosDeFala([{ inicio: 1, fim: 2.5 }, { inicio: 4, fim: 5 }], 6, { folga: 0.15 });
    expect(r.trechos).toEqual([{ inicio: 0, fim: 1.15 }, { inicio: 2.35, fim: 4.15 }, { inicio: 4.85, fim: 6 }]);
    expect(r.removido).toBeCloseTo(1.9, 1);
    expect(preparo.trechosDeFala([{ inicio: 1, fim: 1.5 }], 6, { folga: 0.15 })).toBeNull();
    expect(preparo.trechosDeFala([{ inicio: 0, fim: 6 }], 6)).toBeNull(); // tudo silêncio: não corta
  });

  test('o filtro corta vídeo e áudio juntos', () => {
    const g = preparo.grafoDosTrechos([{ inicio: 0, fim: 1 }, { inicio: 2, fim: 3 }]);
    expect(g).toContain('[0:v]split=2[v0][v1]');
    expect(g).toContain('[a1]atrim=start=2:end=3,asetpts=PTS-STARTPTS[at1]');
    expect(g).toMatch(/concat=n=2:v=1:a=1\[vc\]\[ac\]$/);
  });

  test('vem ligado (normal) por padrão, nos dois modos', () => {
    expect(preparo.normalizarConfig({}).silencios).toBe('normal');
    expect(preparo.normalizarConfig({ modo: 'avancado' }).silencios).toBe('normal');
    expect(preparo.normalizarConfig({ silencios: 'desligado' }).silencios).toBe('desligado');
    expect(preparo.normalizarConfig({ silencios: 'xx' }).silencios).toBe('normal');
  });

  test('título da capa quebra em linhas sem cortar palavra', () => {
    expect(preparo.linhasDoTitulo('Como eu ganhei meus primeiros seguidores')).toEqual(['Como eu ganhei', 'meus primeiros', 'seguidores']);
  });
});

describe('marca d\'água com logo (Postar)', () => {
  test('o arquivo do logo nunca vem do corpo; quem não tem logo segue só com o @', async () => {
    expect(marca.lerDoCorpo({ ativa: true, logo: true, logoArquivo: 'logos/qualquer.png' }).logoArquivo).toBe('');
    const semLogo = require('crypto').randomUUID(); // usuário que nunca enviou logo
    const m = await logoDoUsuario.resolverNaMarca(marca.lerDoCorpo({ ativa: true, logo: true }), semLogo);
    expect(m).toMatchObject({ logo: false, arroba: true });
    expect(await logoDoUsuario.resolverNaMarca(marca.lerDoCorpo({ ativa: true, logo: true, arroba: false }), semLogo)).toBeNull();
  });

  test('o filtro do Postar desenha o logo no canto, com e sem o @', () => {
    const rel = `logos/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}-abcdef12.png`;
    const abs = path.resolve(__dirname, '../uploads', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(LOGO, abs);
    try {
      const so = marca.filtroDaMarca({ ativa: true, arroba: false, logo: true, logoArquivo: rel, logoCanto: 'sup-esq', opacidade: 100 }, 'conta');
      expect(so).toMatch(/^null\[mfb\];movie=/);
      const saida = path.join(DIR, 'marca.png');
      ff(['-i', PRETO, '-vf', so, '-frames:v', '1', saida]);
      const [r, g, b] = cor(saida, 60, 160);
      expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(60); expect(b).toBeLessThan(60);
      const com = marca.filtroDaMarca({ ativa: true, logo: true, logoArquivo: rel }, 'conta');
      expect(com).toMatch(/^drawtext=.*\[mfb\];movie=/);
      ff(['-i', PRETO, '-vf', com, '-frames:v', '1', path.join(DIR, 'marca2.png')]);
    } finally { fs.rmSync(abs, { force: true }); }
  });
});

describe('API', () => {
  let servidor, BASE, token, usuarioId;
  beforeAll(async () => {
    servidor = app.listen(0);
    await new Promise(r => servidor.once('listening', r));
    BASE = `http://127.0.0.1:${servidor.address().port}`;
  });
  afterAll(async () => {
    await new Promise(r => servidor.close(r));
    if (usuarioId) fs.rmSync(path.join(preparo.PASTA, usuarioId), { recursive: true, force: true });
  });
  beforeEach(async () => {
    await banco.limpar();
    _freio.erros.clear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const u = await banco.criarUsuario({ nome: 'Ana', email: 'ana@teste.com', senhaHash: senhas.gerar('senha-boa-123'), status: 'ativo' });
    usuarioId = u.id;
    token = (await api('POST', '/auth/login', { corpo: { username: 'ana@teste.com', password: 'senha-boa-123' } })).dados.token;
  });
  afterEach(() => jest.restoreAllMocks());

  async function api(metodo, rota, { corpo, sem } = {}) {
    const r = await fetch(BASE + rota, {
      method: metodo,
      headers: { ...(corpo && !(corpo instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(!sem && token ? { authorization: `Bearer ${token}` } : {}) },
      body: corpo === undefined ? undefined : corpo instanceof FormData ? corpo : JSON.stringify(corpo),
    });
    const t = await r.text();
    let dados; try { dados = JSON.parse(t); } catch { dados = t; }
    return { status: r.status, dados };
  }
  function enviar(arquivo, config) {
    const fd = new FormData();
    fd.append('config', JSON.stringify(config));
    fd.append('arquivo', new Blob([fs.readFileSync(arquivo)]), path.basename(arquivo));
    return api('POST', '/preparos/arquivos', { corpo: fd });
  }
  async function processar(arquivo, config) {
    const r = await enviar(arquivo, config);
    expect(r.status).toBe(201);
    await preparo.processar({ id: r.dados.item.id });
    return (await api('GET', '/preparos')).dados.itens.find(i => i.id === r.dados.item.id);
  }
  const caminho = async s => (await preparo.saidaDoUsuario(usuarioId, s.id)).caminho;

  test('corte de silêncios: tira as duas pausas e mantém a fala; capa 1080×1920', async () => {
    const item = await processar(FALA, { formatos: ['9x16'], capa: { ativa: true, titulo: 'Três dicas rápidas', posicao: 'topo' } });
    expect(item.status).toBe('concluido');
    expect(item.info.silencios.removido).toBeGreaterThan(1.5);
    expect(item.info.silencios.removido).toBeLessThan(2.3);
    const [video, capa] = item.saidas;
    expect(video.duracao).toBeGreaterThan(3.7);
    expect(video.duracao).toBeLessThan(4.5);
    const streams = execFileSync(FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv=p=0', await caminho(video)]).toString();
    const [dv, da] = streams.trim().split('\n').map(l => Number(l.split(',')[1]));
    expect(Math.abs(dv - da)).toBeLessThan(0.15); // áudio e vídeo continuam juntos
    expect(capa).toMatchObject({ formato: 'capa', ext: 'jpg', largura: 1080, altura: 1920, nome: 'fala - capa.jpg' });
  }, 120_000);

  test('vídeo com logo e corte de pausas juntos (o H.264 recebe o formato certo)', async () => {
    const fd = new FormData();
    fd.append('logo', new Blob([fs.readFileSync(LOGO)]), 'logo.png');
    await api('POST', '/conta/logo', { corpo: fd });
    const item = await processar(FALA, { formatos: ['9x16', '4x5'], logo: { ativa: true, canto: 'inf-dir', opacidade: 100 } });
    expect(item.status).toBe('concluido');
    expect(item.saidas.every(s => !s.erro)).toBe(true);
    const quadro = path.join(DIR, 'quadro.png');
    ff(['-ss', '1', '-i', await caminho(item.saidas[0]), '-frames:v', '1', quadro]);
    const [r, g, b] = cor(quadro, 1080 - 49 - 60, 1920 - 270 - 60);
    expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(60); expect(b).toBeLessThan(60);
  }, 120_000);

  test('desligado, o vídeo sai inteiro', async () => {
    const item = await processar(FALA, { formatos: ['1x1'], silencios: 'desligado' });
    expect(item.info.silencios).toBeNull();
    expect(item.saidas[0].duracao).toBeGreaterThan(5.8);
  }, 120_000);

  test('logo: enviar, aplicar no canto escolhido e remover', async () => {
    const fd = new FormData();
    fd.append('logo', new Blob([fs.readFileSync(LOGO)]), 'logo.png');
    const up = await api('POST', '/conta/logo', { corpo: fd });
    expect(up.status).toBe(200);
    expect(up.dados.arquivo).toMatch(/^logos\/.+\.png$/);
    expect((await api('GET', '/conta/logo')).dados.arquivo).toBe(up.dados.arquivo);

    const item = await processar(PRETO, { formatos: ['9x16'], logo: { ativa: true, canto: 'sup-esq', tamanho: 'medio', opacidade: 100 } });
    const [r, g, b] = cor(await caminho(item.saidas[0]), 60, 160);
    expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(60); expect(b).toBeLessThan(60);
    const [r2] = cor(await caminho(item.saidas[0]), 980, 1700); // canto oposto: sem logo
    expect(r2).toBeLessThan(30);

    expect((await api('DELETE', '/conta/logo')).dados.arquivo).toBeNull();
    expect(fs.existsSync(logoDoUsuario.absoluto(up.dados.arquivo))).toBe(false);
    expect((await api('POST', '/conta/logo', { corpo: (() => { const f = new FormData(); f.append('logo', new Blob(['texto']), 'x.png'); return f; })() })).status).toBe(422);
  }, 120_000);

  test('mandar para a Biblioteca cria a mídia na pasta Variações', async () => {
    const item = await processar(PRETO, { formatos: ['4x5', '1x1'] });
    const r = await api('POST', '/preparos/biblioteca', { corpo: { saidas: item.saidas.map(s => s.id) } });
    expect(r.dados).toEqual({ enviados: 2, erros: 0 });
    const midias = await sql`select original_name, folder, type, filename from media where usuario_id = ${usuarioId} order by original_name`;
    expect(midias.map(m => [m.originalName, m.folder, m.type])).toEqual([['preto - 1x1.jpg', 'Variações', 'image'], ['preto - 4x5.jpg', 'Variações', 'image']]);
    expect((await api('GET', '/preparos')).dados.itens[0].saidas.every(s => s.naBiblioteca)).toBe(true);
    for (const m of midias) fs.rmSync(path.resolve(__dirname, '../uploads', m.filename), { force: true });
  }, 60_000);
});
