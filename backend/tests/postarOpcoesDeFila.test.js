'use strict';

/**
 * As opções de fila do Postar, do corpo da requisição até o job gravado.
 *
 * ── Por que um teste do controller, e não só dos módulos
 *
 * `ordemDasMidias.js` e `marcaDagua.js` têm os próprios testes e passam. Isso
 * não diz nada sobre se alguém os chama, nem se os chama com a forma certa —
 * e essa é a falha mais provável aqui. Já aconteceu duas vezes neste projeto:
 * `processMode` que a tela gravava e o schema descartava, e a mídia por conta
 * perfeita que o caminho do Graph nunca invocava.
 *
 * ── O que este arquivo protege
 *
 *   `multipart` é texto        → 'false' é uma string, e string não vazia é
 *                                verdadeira: sem conversão, desmarcar a chave
 *                                a ligaria
 *   ordem não aplicada         → a opção existiria na tela e a fila sairia na
 *                                ordem do banco, como antes de existir opção
 *   `any(ids)` fora de ordem   → o banco não devolve na ordem dos ids, então
 *                                "na ordem em que eu escolhi" seria mentira
 *   loop infinito ignorado     → `type: 'post'` conclui quando as mídias
 *                                acabam; o loop tem de virar `type: 'loop'`
 *   marca gravada desligada    → campo escrito à toa em todo job de quem nunca
 *                                pediu marca
 */

jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));

const banco = require('./helpers/banco');
const { createPost } = require('../src/controllers/postController');

let CONTAS = [];
const IDS = {};

/** Chama o controller e devolve `{ code, corpo, job }` — o job lido do banco. */
async function postar(body, files = []) {
  const resposta = { code: 200, corpo: null };
  const res = {
    status(c) { resposta.code = c; return this; },
    json(c)   { resposta.corpo = c; return this; },
  };
  await createPost({ body, files }, res);
  const id = resposta.corpo?.job?.id;
  const job = id ? (await banco.sql`select * from jobs where id = ${id}`)[0] : null;
  return { ...resposta, job };
}

/** O corpo mínimo que o controller aceita, como o `multipart` o entrega. */
const corpo = (extra = {}) => ({
  mediaIds: JSON.stringify([IDS.m3, IDS.m1, IDS.m2]),   // fora de ordem de propósito
  accounts: JSON.stringify(CONTAS),
  intervalMinutes: '30',
  postType: 'reel',
  ...extra,
});

beforeEach(async () => {
  await banco.limpar();
  CONTAS = [(await banco.criarConta({ username: 'a' })).id, (await banco.criarConta({ username: 'b' })).id];
  /* Três mídias da biblioteca, com datas bem separadas. Inseridas fora da
     ordem cronológica: o banco não devolve na ordem dos ids pedidos. */
  for (const [chave, filename, quando] of [
    ['m2', 'meio.mp4', '2026-05-01T00:00:00Z'],
    ['m3', 'recente.mp4', '2026-09-01T00:00:00Z'],
    ['m1', 'antigo.mp4', '2026-01-01T00:00:00Z'],
  ]) {
    const [m] = await banco.sql`insert into media (filename, type, created_at) values (${filename}, 'video', ${new Date(quando)}) returning id`;
    IDS[chave] = m.id;
  }
});

describe('a ordem da fila chega ao job', () => {
  test('mais antigos primeiro é o padrão', async () => {
    const { code, job } = await postar(corpo());
    expect(code).toBe(200);
    expect(job.mediaFiles).toEqual(['antigo.mp4', 'meio.mp4', 'recente.mp4']);
    expect(job.ordemDasMidias).toBe('antigos_primeiro');
  });

  test('mais recentes primeiro inverte de verdade', async () => {
    /* Se a opção não fosse aplicada, isto sairia igual ao teste acima — e a
       tela teria um seletor que não faz nada. */
    const { job } = await postar(corpo({ ordemDasMidias: 'recentes_primeiro' }));
    expect(job.mediaFiles).toEqual(['recente.mp4', 'meio.mp4', 'antigo.mp4']);
  });

  test('"na ordem em que eu escolhi" respeita os ids, não o banco', async () => {
    /* O defeito que existia antes de haver opção: os ids pedidos eram
       m3, m1, m2 e o banco devolveu m1, m2, m3. */
    const { job } = await postar(corpo({ ordemDasMidias: 'selecao' }));
    expect(job.mediaFiles).toEqual(['recente.mp4', 'antigo.mp4', 'meio.mp4']);
  });

  test('ordem inventada cai no padrão em vez de sair arbitrária', async () => {
    const { job } = await postar(corpo({ ordemDasMidias: 'bagunca' }));
    expect(job.ordemDasMidias).toBe('antigos_primeiro');
    expect(job.mediaFiles).toEqual(['antigo.mp4', 'meio.mp4', 'recente.mp4']);
  });
});

describe('ordem aleatória', () => {
  test("a string 'true' liga; 'false' NÃO liga", async () => {
    /* `multipart/form-data` só carrega texto. `Boolean('false')` é true, então
       sem a comparação explícita desmarcar a chave a ligaria. */
    const ligada = await postar(corpo({ midiasAleatorias: 'true' }));
    expect(ligada.job.midiasAleatorias).toBe(true);

    const desligada = await postar(corpo({ midiasAleatorias: 'false' }));
    expect(desligada.job.midiasAleatorias).toBe(false);
  });

  test('a semente é gravada, para a ordem ser reproduzível', async () => {
    /* Sem a semente no job, "em que ordem isso foi postado" não tem resposta
       depois — e uma reexecução embaralharia diferente. */
    const { job } = await postar(corpo({ midiasAleatorias: 'true' }));
    expect(typeof job.sementeDaOrdem).toBe('string');
    expect(job.sementeDaOrdem.length).toBeGreaterThan(8);
  });

  test('a mesma semente reproduz a mesma ordem', async () => {
    const a = await postar(corpo({ midiasAleatorias: 'true', sementeDaOrdem: 'fixa' }));
    const b = await postar(corpo({ midiasAleatorias: 'true', sementeDaOrdem: 'fixa' }));
    expect(a.job.mediaFiles).toEqual(b.job.mediaFiles);
  });

  test('não perde nem duplica mídia ao embaralhar', async () => {
    const { job } = await postar(corpo({ midiasAleatorias: 'true' }));
    expect(job.mediaFiles.slice().sort()).toEqual(['antigo.mp4', 'meio.mp4', 'recente.mp4']);
  });
});

describe('modo loop infinito', () => {
  test('vira type loop, que é o que o worker já sabe fazer', async () => {
    /* Não é engine nova: `type: 'loop'` é o que faz o worker voltar ao índice 0
       quando as mídias acabam, em vez de concluir o job. */
    const { job } = await postar(corpo({ loopInfinito: 'true' }));
    expect(job.type).toBe('loop');
  });

  test('sem a opção continua type post', async () => {
    expect((await postar(corpo())).job.type).toBe('post');
    expect((await postar(corpo({ loopInfinito: 'false' }))).job.type).toBe('post');
  });

  test('loop infinito não anuncia um total que nunca chega', async () => {
    /* `postsTotal` alimenta a barra de progresso. Num loop, qualquer número
       seria uma meta falsa — é o mesmo 0 que o loopController grava. */
    const { job } = await postar(corpo({ loopInfinito: 'true' }));
    expect(job.postsTotal).toBe(0);
  });

  test('post normal continua com o total calculado', async () => {
    const { job } = await postar(corpo());
    expect(job.postsTotal).toBe(3 * CONTAS.length);
  });
});

describe('a marca d\'água', () => {
  test('chega como JSON no multipart e é gravada', async () => {
    const { job } = await postar(corpo({
      marcaDagua: JSON.stringify({ ativa: true, opacidade: 70, posicao: 'inferior', tamanho: 'grande' }),
    }));
    expect(job.marcaDagua).toEqual({ ativa: true, opacidade: 70, posicao: 'inferior', tamanho: 'grande' });
  });

  test('desligada não grava campo nenhum', async () => {
    /* Nada muda para quem nunca pediu marca. */
    const { job } = await postar(corpo({ marcaDagua: JSON.stringify({ ativa: false, opacidade: 70 }) }));
    expect(job.marcaDagua).toBeNull();
  });

  test('ausente não grava campo nenhum', async () => {
    expect((await postar(corpo())).job.marcaDagua).toBeNull();
  });

  test('JSON quebrado custa a marca, não a publicação', async () => {
    const { code, job } = await postar(corpo({ marcaDagua: '{ativa:true' }));
    expect(code).toBe(200);
    expect(job.marcaDagua).toBeNull();
  });

  test('valores fora de faixa são normalizados, não gravados crus', async () => {
    /* `opacidade: 500` sairia como `white@5.00` no filtro, e o ffmpeg
       recusaria a linha inteira. */
    const { job } = await postar(corpo({
      marcaDagua: JSON.stringify({ ativa: true, opacidade: 500, posicao: 'diagonal', tamanho: 'gigante' }),
    }));
    expect(job.marcaDagua).toEqual({ ativa: true, opacidade: 100, posicao: 'centro', tamanho: 'pequena' });
  });
});

describe('o que não mudou', () => {
  test('sem mídia continua 400', async () => {
    const { code } = await postar({ ...corpo(), mediaIds: '[]' });
    expect(code).toBe(400);
    expect(await banco.sql`select id from jobs`).toHaveLength(0);
  });

  test('sem conta continua 400', async () => {
    const { code } = await postar(corpo({ accounts: '[]' }));
    expect(code).toBe(400);
  });

  test('intervalo abaixo de 1 minuto continua 400', async () => {
    /* O piso existe porque com 0 as rodadas emendavam sem pausa — o padrão
       mais robotizado que o Postar produzia. */
    expect((await postar(corpo({ intervalMinutes: '0' }))).code).toBe(400);
  });

  test('o agendamento continua virando atraso na fila', async () => {
    const daquiUmaHora = new Date(Date.now() + 3_600_000).toISOString();
    const { job } = await postar(corpo({ scheduledAt: daquiUmaHora }));
    const [rodada] = await banco.sql`select run_at from queue_jobs where name = 'job_round' and data->>'jobId' = ${job.id}`;
    expect(rodada.runAt.getTime() - Date.now()).toBeGreaterThan(3_500_000);
  });
});
