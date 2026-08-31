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
  /* A lista é curta de propósito: só entram códigos que aconteceram de
     verdade. Inventar tradução para código que nunca apareceu produz uma
     explicação convincente e errada, que é pior que nenhuma. */
  const casos = [
    ['TRAFFIC_EXHAUSTED',    /cota de tráfego/i],
    ['QUOTA_EXCEEDED',       /cota/i],
    ['SUBSCRIPTION_EXPIRED', /assinatura/i],
    ['AUTH_FAILED',          /senha/i],
    ['IP_NOT_ALLOWED',       /IPs autorizados/i],
  ];

  test.each(casos)('%s vira frase em português', (codigo, esperado) => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'testProxy.js'), 'utf8');
    expect(fonte).toContain(codigo);
    const linha = fonte.split('\n').find(l => l.includes(codigo + ':'));
    expect(linha).toMatch(esperado);
  });

  test('o código do fornecedor continua na mensagem', () => {
    // Quem for falar com o suporte precisa do código exato, não da tradução.
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'testProxy.js'), 'utf8');
    expect(fonte).toMatch(/O proxy recusou: \$\{traduzido\}/);
    expect(fonte).toMatch(/texto \+= ` \(\$\{motivo\}\)`/);
  });

  test('a frase da linha de status é lida, não só o corpo', () => {
    // `TRAFFIC_EXHAUSTED` veio em `res.statusMessage`. Ler só o corpo foi o
    // que fez a primeira versão continuar muda.
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'testProxy.js'), 'utf8');
    expect(fonte).toMatch(/res\.statusMessage/);
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
