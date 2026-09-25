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
 *  2. Comentava na "mídia mais recente da conta", descoberta por consulta
 *     depois de esperar dois minutos. Conta que publicasse outra coisa nesse
 *     meio recebia o comentário no post errado.
 *
 * ── O que estes testes protegem
 *
 *   variável trocada     → `{nome}` voltando a sair como @
 *   comentário quebrado  → modelo antigo com "{link}" (variável que saiu) não
 *                          pode ser publicado com a marcação crua no post
 *   saída silenciosa     → cada motivo de não comentar tem nome, porque o
 *                          sintoma antes era "liguei e não aconteceu nada"
 *   comentário em branco → o Instagram recusa, e a recusa apareceria como erro
 *                          sem causa aparente
 */

const {
  montarMensagem, decidirComentario, ATRASO_MS,
} = require('../src/services/comentarioDoPost');

const CONTA = { username: 'loja_da_ana', name: 'Loja da Ana' };
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

  test('as variáveis não diferenciam maiúscula', () => {
    /* Quem digita {NOME} espera que funcione. */
    expect(montarMensagem('{USERNAME} {Nome}', { username: 'x', nome: 'Ana' })).toBe('@x Ana');
  });

  test('{data} e {hora} usam o momento informado', () => {
    /* Informado e não `new Date()` interno: senão o teste ou passa por
       acidente ou falha à meia-noite. */
    const r = montarMensagem('{data} {hora}', {}, QUANDO);
    expect(r).toContain('07/09/2026');
    expect(r).toMatch(/14:35/);
  });

  test('variável sem valor sai vazia, não como "undefined"', () => {
    expect(montarMensagem('[{nome}][{cidade}]', {})).toBe('[][]');
  });

  test('texto que não é texto devolve vazio', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(montarMensagem(v, { nome: 'x' })).toBe('');
    }
  });

  test('texto sem variável passa intacto', () => {
    expect(montarMensagem('Comenta aí! 👇', {})).toBe('Comenta aí! 👇');
  });
});

describe('o @ na frente de {username}', () => {
  /* O jeito natural de escrever uma menção é "@{username}". Como a variável
     já sai com o @, isso dava "@@conta" — e @@ não menciona ninguém. */
  test('"@{username}" e "{username}" dão o mesmo resultado', () => {
    expect(montarMensagem('Completo nos destaques! 🔥➡️ @{username}', { username: 'elisangela' }))
      .toBe('Completo nos destaques! 🔥➡️ @elisangela');
    expect(montarMensagem('Completo nos destaques! 🔥➡️ {username}', { username: 'elisangela' }))
      .toBe('Completo nos destaques! 🔥➡️ @elisangela');
  });

  test('username gravado com @ também não dobra', () => {
    expect(montarMensagem('@{username}', { username: '@elisangela' })).toBe('@elisangela');
  });

  test('cada conta recebe o próprio @', () => {
    const modelo = 'Completo nos destaques! 🔥➡️ @{username}';
    expect(montarMensagem(modelo, { username: 'conta_a' })).toContain('@conta_a');
    expect(montarMensagem(modelo, { username: 'conta_b' })).toContain('@conta_b');
  });
});

describe('a decisão de comentar', () => {
  test('caso normal: comenta com o texto resolvido', () => {
    const d = decidirComentario({ modelo: 'Oi {nome}, veja {username}', account: CONTA, mediaId: '17900', agora: QUANDO });
    expect(d.comentar).toBe(true);
    expect(d.texto).toBe('Oi Loja da Ana, veja @loja_da_ana');
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

  test('modelo antigo com {link} não é publicado com a marcação crua', () => {
    expect(decidirComentario({ modelo: '👇 Acesse!\n🤖 {link}', account: CONTA, mediaId: '1' }))
      .toMatchObject({ comentar: false, motivo: 'usa_variavel_link_removida' });
  });

  test('modelo que resolve para vazio, não comenta', () => {
    /* "{cidade}" sozinho, com a cidade em branco, dá texto vazio. O Instagram
       recusa comentário em branco, e a recusa apareceria como erro sem causa. */
    expect(decidirComentario({ modelo: '{cidade}', account: CONTA, mediaId: '1' }))
      .toMatchObject({ comentar: false, motivo: 'texto_vazio_apos_variaveis' });
  });

  test('cada motivo tem nome — nenhuma saída é silenciosa', () => {
    /* O sintoma antes era "liguei o comentário e não aconteceu nada". Com
       nome, o log diz qual dos casos foi. */
    const motivos = new Set([
      decidirComentario({ modelo: '', account: CONTA, mediaId: '1' }).motivo,
      decidirComentario({ modelo: 'oi', account: CONTA, mediaId: '' }).motivo,
      decidirComentario({ modelo: '{link}', account: CONTA, mediaId: '1' }).motivo,
      decidirComentario({ modelo: '{cidade}', account: CONTA, mediaId: '1' }).motivo,
      decidirComentario({ modelo: 'oi', account: CONTA, mediaId: '1' }).motivo,
    ]);
    expect(motivos.size).toBe(5);
    expect([...motivos]).not.toContain(undefined);
  });

  test('o texto sai sem espaços nas pontas', () => {
    /* "{cidade}\n" com cidade vazia deixaria um comentário com espaço solto. */
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
  const worker = ler('../src/worker.js');

  test('o comentário é agendado na FILA, não esperado na memória', () => {
    /* Esperar no processo perderia o comentário num restart dentro da janela. */
    expect(worker).toMatch(/fila\.enfileirar\('comentario_fixado'/);
    expect(worker).toContain('{ atrasoMs: ATRASO_MS }');
  });

  test('a fila sabe processar o tipo', () => {
    /* Enfileirar um tipo sem handler deixa o trabalho na fila sem nunca rodar. */
    expect(worker).toContain('comentario_fixado: processarComentarioFixado');
  });

  test('comenta pela API oficial, na mídia que a publicação devolveu', () => {
    const trecho = worker.slice(worker.indexOf('async function processarComentarioFixado'));
    expect(trecho.slice(0, 600)).toContain('graph.comentar(conta, mediaId, texto)');
    expect(worker).toContain('agendarComentarioFixado(conta, post, mediaId)');
  });

  test('o comentário que falha não é tentado de novo', () => {
    /* Relançar faria a fila repetir e comentar duas vezes no mesmo post. */
    const trecho = worker.slice(worker.indexOf('async function processarComentarioFixado'));
    expect(trecho.slice(0, 900)).toContain('Não relança');
  });

  test('a pergunta de engajamento saiu das telas', () => {
    expect(ler('../../frontend/src/pages/Posts.jsx')).not.toContain('engageComment');
    expect(ler('../../frontend/src/pages/Loop.jsx')).not.toContain('engageComment');
  });
});
