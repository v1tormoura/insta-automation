'use strict';

/**
 * A cota de publicação da API do Instagram — 50 por conta em 24h.
 *
 * O que estes testes protegem: o job bateu nessa parede 55 vezes seguidas em
 * 20/09/2026, uma a cada 10 minutos, por 13 horas — cada tentativa virando um
 * Post com erro em francês e consumindo uma rodada. Três coisas não podem
 * regredir: a mensagem do Meta ser reconhecida em qualquer idioma, a consulta
 * ler `quota_usage` e comparar com 50 (não com o `quota_total` legado de 100),
 * e a estimativa de quando libera fazer sentido para uma janela deslizante.
 */

const cota = require('../src/services/cotaDaApi');

const conta = { _id: 'c1', username: 'elisangela', accessToken: 'IGtoken', igUserId: '17841400000000000' };

/** Um fetch falso que devolve o JSON da Graph. */
const fetchCom = corpo => async () => ({ json: async () => corpo });

beforeEach(() => cota._cache.clear());

describe('reconhecer a recusa do Meta', () => {
  test('em francês — a mensagem que chegou de verdade', () => {
    expect(cota.ehErroDeCota(new Error("Vous avez atteint le nombre maximal de publications pouvant être publiées par l'API Content Publishing."))).toBe(true);
  });

  test('em inglês e em português', () => {
    expect(cota.ehErroDeCota(new Error('You have reached the maximum number of posts that can be published via the Content Publishing API'))).toBe(true);
    expect(cota.ehErroDeCota(new Error('Você atingiu o número máximo de publicações'))).toBe(true);
    expect(cota.ehErroDeCota('content_publish_rate_limit')).toBe(true);
  });

  test('outros erros não são cota', () => {
    expect(cota.ehErroDeCota(new Error('Error validating access token'))).toBe(false);
    expect(cota.ehErroDeCota(new Error('Processamento falhou: ERROR'))).toBe(false);
    expect(cota.ehErroDeCota(null)).toBe(false);
  });
});

describe('consultar a cota', () => {
  test('lê quota_usage e compara com 50, não com o quota_total legado', async () => {
    /* O caso real: config diz 100, o Meta recusa em 50. */
    const r = await cota.consultar(conta, { fetchImpl: fetchCom({ data: [{ quota_usage: 50, config: { quota_total: 100, quota_duration: 86400 } }] }) });
    expect(r.usage).toBe(50);
    expect(r.total).toBe(100);
    expect(r.limite).toBe(50);
    expect(r.cheia).toBe(true);
  });

  test('abaixo do limite, não está cheia', async () => {
    const r = await cota.consultar(conta, { fetchImpl: fetchCom({ data: [{ quota_usage: 42, config: { quota_total: 100 } }] }) });
    expect(r.cheia).toBe(false);
  });

  test('cache de 60s: a segunda consulta não bate na Graph', async () => {
    let chamadas = 0;
    const f = async () => { chamadas++; return { json: async () => ({ data: [{ quota_usage: 10 }] }) }; };
    await cota.consultar(conta, { fetchImpl: f, agora: 1_000_000 });
    await cota.consultar(conta, { fetchImpl: f, agora: 1_000_000 + 30_000 });
    expect(chamadas).toBe(1);
    await cota.consultar(conta, { fetchImpl: f, agora: 1_000_000 + 61_000 });
    expect(chamadas).toBe(2);
  });

  test('falha na consulta devolve null — e null NÃO bloqueia', async () => {
    /* Bloquear por soluço de rede pararia a fila inteira. */
    expect(await cota.consultar(conta, { fetchImpl: async () => { throw new Error('ETIMEDOUT'); } })).toBeNull();
    expect(await cota.consultar(conta, { fetchImpl: fetchCom({ error: { message: 'Invalid OAuth' } }) })).toBeNull();
  });

  test('conta sem token (instagrapi) não tem cota da Graph', async () => {
    expect(await cota.consultar({ _id: 'x', username: 'mobile' })).toBeNull();
  });

  test('marcarCheia grava no cache e vale para a próxima consulta', async () => {
    cota.marcarCheia(conta, { agora: 5_000_000 });
    const r = await cota.consultar(conta, { fetchImpl: fetchCom({ data: [{ quota_usage: 3 }] }), agora: 5_000_000 + 1000 });
    expect(r.cheia).toBe(true);
    expect(r.usage).toBe(50);
  });
});

describe('quando libera — janela deslizante', () => {
  const H = 60 * 60 * 1000;
  const agora = new Date('2026-09-20T14:00:00Z');

  test('com 50+ registros, libera quando a mais antiga das últimas 50 completa 24h', () => {
    // 60 publicações, uma por 10 min, a última há 10 min. As últimas 50 começam há 500 min.
    const momentos = Array.from({ length: 60 }, (_, i) => new Date(agora.getTime() - (i + 1) * 10 * 60_000));
    const libera = cota.liberacaoEstimada(momentos, agora);
    const maisAntigaDasUltimas50 = agora.getTime() - 50 * 10 * 60_000;
    expect(libera.getTime()).toBe(maisAntigaDasUltimas50 + 24 * H);
  });

  test('com registro incompleto, libera quando a mais antiga conhecida completa 24h', () => {
    const momentos = [new Date(agora.getTime() - 20 * H), new Date(agora.getTime() - 2 * H)];
    expect(cota.liberacaoEstimada(momentos, agora).getTime()).toBe(agora.getTime() - 20 * H + 24 * H);
  });

  test('sem registro nenhum, tenta em 1h em vez de chutar', () => {
    expect(cota.liberacaoEstimada([], agora).getTime()).toBe(agora.getTime() + H);
  });

  test('a estimativa é sempre no futuro quando há registro recente', () => {
    const momentos = [new Date(agora.getTime() - 5 * 60_000)];
    expect(cota.liberacaoEstimada(momentos, agora).getTime()).toBeGreaterThan(agora.getTime());
  });
});

describe('a mensagem', () => {
  test('diz o número e a hora, em português', () => {
    const m = cota.motivo({ usage: 50, limite: 50 }, new Date(2026, 8, 20, 14, 35));
    expect(m).toContain('50/50');
    expect(m).toContain('14:35');
    expect(m).toMatch(/cota da API do Instagram/);
  });
});

describe('o worker usa a cota', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(path.resolve(__dirname, '../src/queue/worker.js'), 'utf8');

  test('a rodada consulta a cota antes de criar Post', () => {
    expect(fonte).toContain('ritmo: await podePublicarAgora(');
  });

  test('a recusa real da Graph marca a cota como cheia', () => {
    expect(fonte).toContain(".marcarCheia(account)");
  });

  test('a rodada adiada espera até a liberação, com teto', () => {
    expect(fonte).toContain('TETO_ESPERA_MS');
    expect(fonte).toContain('Math.max(intervaloDoJob, ateLiberar)');
  });

  test('cota cheia gera aviso', () => {
    expect(fonte).toContain('notificarCotaDaApi');
  });
});
