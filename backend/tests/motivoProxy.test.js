/**
 * O motivo que o fornecedor de proxy dá, traduzido.
 *
 * ── Por que isto existe
 *
 * O proxy respondeu `HTTP/1.1 407 TRAFFIC_EXHAUSTED` — a cota de tráfego do
 * plano tinha acabado. A tela mostrava "Proxy respondeu HTTP 407", e esse
 * número é a mesma resposta para senha errada, assinatura vencida, IP não
 * autorizado e cota esgotada. Quatro causas, quatro soluções, e a única que
 * importava estava escrita na resposta e sendo descartada.
 *
 * A frase vem na LINHA DE STATUS, não no corpo — foi por isso que a primeira
 * versão, que só lia o corpo, continuou sem mostrar nada.
 */

const testProxy = require('../src/services/testProxy');

describe('tradução do motivo', () => {
  /* Testam o COMPORTAMENTO, não o texto do arquivo. A primeira versão liava a
     tabela de dentro do `testProxy.js` por leitura de fonte, e quebrou toda
     no instante em que a tabela mudou de arquivo — sem que nada tivesse
     deixado de funcionar. Teste que casa com o texto do código mede onde a
     coisa mora, não o que ela faz. */
  const { traduzir, MOTIVOS } = require('../src/utils/motivoProxy');

  const casos = [
    ['TRAFFIC_EXHAUSTED',    /cota de tráfego/i],
    ['QUOTA_EXCEEDED',       /cota/i],
    ['SUBSCRIPTION_EXPIRED', /assinatura/i],
    ['AUTH_FAILED',          /senha/i],
    ['IP_NOT_ALLOWED',       /IPs autorizados/i],
  ];

  test.each(casos)('%s vira frase em português', (codigo, esperado) => {
    expect(traduzir(`HTTP/1.1 407 ${codigo}`)).toMatch(esperado);
  });

  test('reconhece o código no meio de um texto qualquer', () => {
    // Ele chega embrulhado num rastro de pilha do Python, não sozinho.
    expect(traduzir("OSError('Tunnel connection failed: 407 TRAFFIC_EXHAUSTED')"))
      .toMatch(/cota de tráfego/i);
  });

  test('a lista é curta de propósito', () => {
    /* Só entram códigos que aconteceram de verdade. Inventar tradução para
       código que nunca apareceu produz explicação convincente e errada — pior
       que a frase genérica, porque a genérica ao menos não afirma nada. */
    expect(Object.keys(MOTIVOS).length).toBeLessThanOrEqual(8);
  });

  test('todas as frases dizem o que FAZER, não só o que houve', () => {
    // "cota esgotada" descreve; "renove no painel do fornecedor" resolve.
    // O Jest não aceita segundo argumento no `expect` — aquilo é vitest, e
    // este arquivo roda no Jest. Listar as curtas dá a mesma informação e
    // mostra TODAS de uma vez, em vez de parar na primeira.
    const curtas = Object.entries(MOTIVOS)
      .filter(([, frase]) => frase.length <= 40)
      .map(([codigo, frase]) => `${codigo}: "${frase}"`);
    expect(curtas).toEqual([]);
  });
});

describe('o teste em si continua funcionando', () => {
  test('proxy vazio responde sem tentar a rede', async () => {
    const r = await testProxy('');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Proxy vazio');
  });

  test('URL inválida não derruba o teste', async () => {
    const r = await testProxy('://sem-esquema-nem-host');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

describe('o mesmo motivo serve os dois caminhos', () => {
  /* A resposta do fornecedor aparece em dois lugares que não se falam: o teste
     do painel de Proxies e a falha de login vinda do serviço Python. Antes
     cada um dizia uma coisa — "HTTP 407" e "verifique se o proxy está ativo e
     funcionando" — e a segunda é pior que inútil, porque o proxy ESTAVA ativo.

     Duas cópias da tabela divergiriam no primeiro código novo, e a divergência
     ficaria escondida no caminho menos usado. */
  const { traduzir } = require('../src/utils/motivoProxy');

  test('traduz o detalhe cru que o Python devolve no login', () => {
    const detalhe = "ProxyError: HTTPSConnectionPool(host='i.instagram.com', port=443): "
      + "Max retries exceeded with url: /api/v1/qe/sync/ (Caused by ProxyError("
      + "'Unable to connect to proxy', OSError('Tunnel connection failed: 407 TRAFFIC_EXHAUSTED')))";
    expect(traduzir(detalhe)).toMatch(/cota de tráfego/i);
  });

  test('código desconhecido devolve vazio, e a mensagem curada continua valendo', () => {
    // Inventar tradução para código que nunca apareceu produz explicação
    // convincente e errada — pior que a frase genérica.
    expect(traduzir('Tunnel connection failed: 407 ALGO_NOVO')).toBe('');
  });

  test('o testProxy usa o módulo em vez de ter a sua própria cópia', () => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'testProxy.js'), 'utf8');
    expect(fonte).toMatch(/require\('\.\.\/utils\/motivoProxy'\)/);
    expect(fonte).not.toMatch(/TRAFFIC_EXHAUSTED:/);
  });

  test('a rota de contas também usa o módulo', () => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'routes', 'accountRoutes.js'), 'utf8');
    expect(fonte).toMatch(/motivoProxy/);
    // E antes da mensagem curada, senão a genérica ganharia sempre.
    const iMotivo = fonte.indexOf('motivoProxy');
    const iCurada = fonte.indexOf('if (INSTA_ERROR_MESSAGES[code]) return');
    expect(iMotivo).toBeLessThan(iCurada);
  });
});
