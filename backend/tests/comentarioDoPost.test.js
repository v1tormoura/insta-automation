'use strict';

/**
 * O comentário fixado automático.
 *
 * ── Três defeitos que estavam lá, e por que nenhum aparecia
 *
 * A função existia, a tela dizia "Ativo", e três coisas não funcionavam:
 *
 *  1. `{nome}` NUNCA funcionou. `buildMessage` lia `vars.name` e quem chamava
 *     passava `vars.nome`. A variável caía no fallback e virava o @ — a tela
 *     oferecia três variáveis e entregava duas. Nada no comportamento
 *     denunciava: saía um @ onde devia sair um nome.
 *
 *  2. Conta mobile não recebia comentário NENHUM. A função abria com
 *     `if (!account.accessToken || !account.igUserId) return;` e saía calada.
 *     Num sistema onde a maioria das contas entra por senha, era a maioria.
 *
 *  3. Comentava na "mídia mais recente da conta", descoberta por consulta
 *     depois de esperar dois minutos. Conta que publicasse outra coisa nesse
 *     meio recebia o comentário no post errado.
 *
 * ── O que estes testes protegem
 *
 *   variável trocada     → `{nome}` voltando a sair como @
 *   comentário quebrado  → modelo "🤖 {link}" sem promoLink vira "🤖 " e fica
 *                          publicado no post para todo mundo ver
 *   saída silenciosa     → cada motivo de não comentar tem nome, porque o
 *                          sintoma antes era "liguei e não aconteceu nada"
 *   comentário em branco → o Instagram recusa, e a recusa apareceria como erro
 *                          sem causa aparente
 */

const {
  montarMensagem, decidirComentario, faltaOLink, ATRASO_MS,
} = require('../src/services/comentarioDoPost');

const CONTA = { username: 'loja_da_ana', name: 'Loja da Ana', promoLink: 'https://t.me/bot' };
const QUANDO = new Date('2026-09-07T14:35:00');

describe('as variáveis do texto', () => {
  test('{nome} sai o nome, não o @', () => {
    /* O defeito em uma frase: `vars.name` de um lado, `vars.nome` do outro, e
       `{nome}` virava o @ sem nada denunciar. */
    expect(montarMensagem('Oi, {nome}!', { username: 'loja_da_ana', nome: 'Loja da Ana' }))
      .toBe('Oi, Loja da Ana!');
  });

  test('sem nome cadastrado, {nome} cai no @', () => {
    /* Um buraco no texto seria pior. O @ é o que a pessoa reconhece. */
    expect(montarMensagem('Oi, {nome}!', { username: 'loja_da_ana' })).toBe('Oi, @loja_da_ana!');
  });

  test('{username} sai com um arroba só', () => {
    /* O @ chega às vezes com arroba (do toast) e às vezes sem (do banco).
       Concatenar sem normalizar produziria "@@loja_da_ana". */
    expect(montarMensagem('{username}', { username: 'loja_da_ana' })).toBe('@loja_da_ana');
    expect(montarMensagem('{username}', { username: '@loja_da_ana' })).toBe('@loja_da_ana');
    expect(montarMensagem('{username}', { username: '@@loja_da_ana' })).toBe('@loja_da_ana');
  });

  test('{link} sai o link', () => {
    expect(montarMensagem('Acesse {link}', { link: 'https://t.me/bot' })).toBe('Acesse https://t.me/bot');
  });

  test('as variáveis não diferenciam maiúscula', () => {
    /* Quem digita {LINK} espera que funcione. */
    expect(montarMensagem('{LINK} {Nome}', { link: 'x', nome: 'Ana' })).toBe('x Ana');
  });

  test('{data} e {hora} usam o momento informado', () => {
    /* Informado e não `new Date()` interno: senão o teste ou passa por
       acidente ou falha à meia-noite. */
    const r = montarMensagem('{data} {hora}', {}, QUANDO);
    expect(r).toContain('07/09/2026');
    expect(r).toMatch(/14:35/);
  });

  test('variável sem valor sai vazia, não como "undefined"', () => {
    expect(montarMensagem('[{link}][{cidade}]', {})).toBe('[][]');
  });

  test('texto que não é texto devolve vazio', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(montarMensagem(v, { link: 'x' })).toBe('');
    }
  });

  test('texto sem variável passa intacto', () => {
    expect(montarMensagem('Comenta aí! 👇', {})).toBe('Comenta aí! 👇');
  });
});

describe('o link que falta', () => {
  test('modelo com {link} e conta sem promoLink', () => {
    /* O modelo padrão da tela é "🤖 {link}". Sem link ele vira "🤖 " —
       um comentário com um emoji e nada, publicado no post. */
    expect(faltaOLink('🤖 {link}', { username: 'a' })).toBe(true);
    expect(faltaOLink('🤖 {link}', { username: 'a', promoLink: '   ' })).toBe(true);
  });

  test('com promoLink não falta', () => {
    expect(faltaOLink('🤖 {link}', CONTA)).toBe(false);
  });

  test('modelo sem {link} não depende dele', () => {
    expect(faltaOLink('Comenta aí!', { username: 'a' })).toBe(false);
  });
});

describe('a decisão de comentar', () => {
  test('caso normal: comenta com o texto resolvido', () => {
    const d = decidirComentario({ modelo: 'Oi {nome}, veja {link}', account: CONTA, mediaId: '17900', agora: QUANDO });
    expect(d.comentar).toBe(true);
    expect(d.texto).toBe('Oi Loja da Ana, veja https://t.me/bot');
  });

  test('sem texto, não comenta', () => {
    for (const m of ['', '   ', null, undefined]) {
      expect(decidirComentario({ modelo: m, account: CONTA, mediaId: '1' }))
        .toMatchObject({ comentar: false, motivo: 'sem_texto' });
    }
  });

  test('sem id da mídia, não comenta', () => {
    /* Antes isto era resolvido procurando "a mídia mais recente da conta" —
       que podia ser outra publicação. Sem id não há onde comentar, e adivinhar
       é pior que não comentar. */
    expect(decidirComentario({ modelo: 'oi', account: CONTA, mediaId: '' }))
      .toMatchObject({ comentar: false, motivo: 'sem_media_id' });
    expect(decidirComentario({ modelo: 'oi', account: CONTA, mediaId: null }).motivo).toBe('sem_media_id');
  });

  test('sem promoLink e modelo que o usa, não comenta', () => {
    expect(decidirComentario({ modelo: '🤖 {link}', account: { username: 'a' }, mediaId: '1' }))
      .toMatchObject({ comentar: false, motivo: 'sem_promo_link' });
  });

  test('modelo que resolve para vazio, não comenta', () => {
    /* "{cidade}" sozinho, com a cidade em branco, dá texto vazio. O Instagram
       recusa comentário em branco, e a recusa apareceria como erro sem causa. */
    expect(decidirComentario({ modelo: '{cidade}', account: CONTA, mediaId: '1' }))
      .toMatchObject({ comentar: false, motivo: 'texto_vazio_apos_variaveis' });
  });

  test('cada motivo tem nome — nenhuma saída é silenciosa', () => {
    /* O sintoma antes era "liguei o comentário e não aconteceu nada". Com
       nome, o log diz qual dos quatro casos foi. */
    const motivos = new Set([
      decidirComentario({ modelo: '', account: CONTA, mediaId: '1' }).motivo,
      decidirComentario({ modelo: 'oi', account: CONTA, mediaId: '' }).motivo,
      decidirComentario({ modelo: '{link}', account: { username: 'a' }, mediaId: '1' }).motivo,
      decidirComentario({ modelo: '{cidade}', account: CONTA, mediaId: '1' }).motivo,
      decidirComentario({ modelo: 'oi', account: CONTA, mediaId: '1' }).motivo,
    ]);
    expect(motivos.size).toBe(5);
    expect([...motivos]).not.toContain(undefined);
  });

  test('o texto sai sem espaços nas pontas', () => {
    /* "🤖 {link}\n" com link vazio deixaria um comentário com espaço solto. */
    expect(decidirComentario({ modelo: '  Oi {nome}  ', account: CONTA, mediaId: '1' }).texto)
      .toBe('Oi Loja da Ana');
  });
});

describe('o atraso', () => {
  test('são dois minutos', () => {
    /* A mídia precisa estar indexada para aceitar comentário — e comentar no
       próprio post no mesmo segundo em que ele sobe não é o que uma pessoa
       faz. */
    expect(ATRASO_MS).toBe(120_000);
  });
});

describe('a ligação com o worker', () => {
  const fs = require('fs');
  const path = require('path');
  const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
  const worker = ler('../src/queue/worker.js');

  test('o comentário é agendado na FILA, não esperado na memória', () => {
    /* `await delay(120_000)` guardava a espera no processo: restart na janela
       perdia o comentário sem deixar rastro. */
    /* Regex e não string literal: o arquivo tem CRLF no Windows, e um `\n`
       cravado no teste passaria a depender do fim de linha do checkout. */
    expect(worker).toMatch(/postQueue\.add\(\s*'comentario_fixado'/);
    expect(worker).toContain('delay: ATRASO_MS');
    /* E o caminho antigo não pode ter voltado a ser chamado. Assertiva sobre
       CHAMADA e não sobre o texto "delay(120_000)": esse texto aparece no
       comentário que explica o defeito, e um teste que não distingue prosa de
       código falha por causa da própria documentação. */
    expect(worker).not.toMatch(/postCTACommentForPost\s*\(/);
  });

  test('a fila sabe processar o tipo novo', () => {
    /* Enfileirar um tipo que o worker não trata deixa o job girando sem nunca
       rodar — e nada no painel diz isso. */
    expect(worker).toContain("job.name === 'comentario_fixado'");
    expect(worker).toContain('processarComentarioFixado(job.data)');
  });

  test('despacha pelo ProviderFactory — é o que faz funcionar em conta mobile', () => {
    /* A linha que corrige o defeito 2. Conta instagrapi comenta pelo serviço
       Python, conta oficial pela Graph — o mesmo despacho da campanha. */
    const trecho = worker.slice(worker.indexOf('async function processarComentarioFixado'));
    expect(trecho.slice(0, 900)).toContain('getProvider(conta).comment(conta, { mediaId, text: texto })');
  });

  test('usa o mediaId que a publicação devolveu', () => {
    /* Não "a mídia mais recente da conta". */
    expect(worker).toContain("const idDaMidia = String(resultado?.mediaId || '');");
    expect(worker).toContain('agendarComentarioFixado(account, post, idDaMidia)');
  });

  test('o comentário que falha não é tentado de novo', () => {
    /* Relançar faria o BullMQ repetir e comentar duas vezes no mesmo post. */
    const trecho = worker.slice(worker.indexOf('async function processarComentarioFixado'));
    expect(trecho.slice(0, 1400)).toContain('Não relança');
  });

  test('as funções antigas saíram do promoJob', () => {
    /* Código morto que continua exportado convida alguém a chamá-lo de novo —
       e ele traz os três defeitos de volta. */
    const promo = ler('../src/jobs/promoJob.js');
    expect(promo).not.toContain('async function postCTACommentForPost');
    expect(promo).not.toContain('async function postEngageCommentForPost');
    expect(promo).not.toContain('postCTACommentForPost,');
  });

  test('a pergunta de engajamento saiu das telas', () => {
    /* Removida a pedido. Os campos ficam nos schemas para não apagar o que já
       está gravado, mas nada mais os envia nem os dispara. */
    expect(ler('../../frontend/src/pages/Posts.jsx')).not.toContain('engageComment');
    expect(ler('../../frontend/src/pages/Loop.jsx')).not.toContain('engageComment');
    expect(worker).not.toContain('postEngageCommentForPost');
  });
});
