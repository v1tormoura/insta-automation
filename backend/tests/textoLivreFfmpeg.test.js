'use strict';

/**
 * O filtro de texto, executado pelo ffmpeg de verdade.
 *
 * ── Por que este arquivo existe
 *
 * textoLivreStory.test.js compara strings: garante que o filtro tenha a forma
 * esperada. Isso não prova que o ffmpeg o aceita. A vírgula dentro de
 * `max(a\,b)` é o exemplo exato: sem a barra, a string continua "certa" para
 * qualquer expectativa que eu escrevesse, e o ffmpeg parte o filtro em dois no
 * meio da expressão. Só executando dá para saber.
 *
 * Roda com o binário de `ffmpeg-static`, que é o mesmo que o serviço usa.
 * Sobre uma entrada sintética (`color`), sem arquivo nem rede.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);
const ffmpegStatic = require('ffmpeg-static');
const { filtrosDeTexto, acharFonte } = require('../src/services/storyStickerRenderer');

const fonte = acharFonte();

/* Sem fonte no host não há o que testar — e falhar aqui seria falhar por causa
   do ambiente, não do código. O serviço já trata a ausência devolvendo lista
   vazia, e isso tem teste próprio no arquivo de strings. */
const talvez = fonte ? describe : describe.skip;

/**
 * Roda o filtro sobre um quadro sintético e devolve o que o ffmpeg disse.
 *
 * `-f lavfi -i color` gera a entrada: nada é lido do disco, então uma falha
 * aqui só pode vir do filtro.
 */
async function rodar(textoLivre) {
  const filtros = filtrosDeTexto(textoLivre, fonte);
  if (!filtros.length) throw new Error('filtrosDeTexto devolveu vazio');

  const saida = path.join(os.tmpdir(), `mf-texto-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=gray:s=1080x1920:d=1',
    '-frames:v', '1',
    '-vf', filtros.join(','),
    '-y', saida,
  ];

  try {
    await execFileAsync(ffmpegStatic, args, { timeout: 40000 });
    const bytes = fs.statSync(saida).size;
    return { ok: true, bytes };
  } finally {
    try { fs.unlinkSync(saida); } catch { /* já não existe */ }
  }
}

talvez('o ffmpeg aceita o filtro', () => {
  jest.setTimeout(60000);

  test('uma linha simples', async () => {
    const r = await rodar({ texto: 'Promoção de hoje' });
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
  });

  test('a expressão de x com vírgulas escapadas não parte o filtro', async () => {
    /* O caso que motivou o arquivo. Uma vírgula sem escape encerra o filtro
       ali mesmo, e o resto da expressão vira um nome de filtro inexistente —
       "No such filter: 'min(1052-text_w'". */
    const filtro = filtrosDeTexto({ texto: 'x' }, fonte)[0];
    expect(filtro).toContain(String.raw`max(28\,min(`);
    await expect(rodar({ texto: 'x' })).resolves.toMatchObject({ ok: true });
  });

  test('várias linhas', async () => {
    const r = await rodar({ texto: 'primeira\nsegunda\nterceira' });
    expect(r.ok).toBe(true);
  });

  test('apóstrofo, dois-pontos, porcento e barra', async () => {
    /* Os quatro caracteres com significado próprio dentro de um drawtext.
       Se o escape do renderizador estiver errado, é aqui que aparece. */
    await expect(rodar({ texto: "50%: n'oferta \\ hoje" })).resolves.toMatchObject({ ok: true });
  });

  test('acentos e emoji não derrubam o filtro', async () => {
    /* O emoji provavelmente sai como caixa vazia — a fonte do sistema pode não
       ter o glifo. O que importa aqui é que o comando não FALHE por causa
       dele: um story sem um emoji é aceitável, um story que não sai não é. */
    await expect(rodar({ texto: 'ação à noite 🎉' })).resolves.toMatchObject({ ok: true });
  });

  test('nas quatro bordas', async () => {
    /* O clamp em ação. Antes dele, y=1 desenhava metade do texto fora do
       quadro; o ffmpeg aceitava e cortava calado. */
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      await expect(rodar({ texto: 'borda', x, y })).resolves.toMatchObject({ ok: true });
    }
  });

  test('os três tamanhos', async () => {
    for (const tamanho of ['pequeno', 'medio', 'grande']) {
      await expect(rodar({ texto: 'tamanho', tamanho })).resolves.toMatchObject({ ok: true });
    }
  });

  test('texto preto sobre caixa branca', async () => {
    await expect(rodar({ texto: 'invertido', cor: 'preto' })).resolves.toMatchObject({ ok: true });
  });

  test('sem posição — o caso que saía com NaN', async () => {
    /* `x=(NaN-text_w/2)` fazia o ffmpeg recusar a mídia inteira, com uma
       mensagem que não menciona posição. */
    await expect(rodar({ texto: 'sem coordenada' })).resolves.toMatchObject({ ok: true });
  });
});
