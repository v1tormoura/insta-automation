'use strict';

/**
 * Variação de legenda por conta (spintax).
 *
 *   determinístico por semente  → a MESMA conta, num retry, recebe a MESMA
 *                                 legenda (não gera duas para uma publicação só)
 *   varia entre contas          → contas diferentes recebem combinações diferentes
 *   sem chaves, não mexe        → aplicar sempre é seguro
 *   `temVariacao` não é estatal → o footgun do regex global
 */

const { resolverLegenda, temVariacao } = require('../src/services/variarLegenda');

const TPL = '{Bom dia|Oi|E aí}! {salva|guarda} pra não perder';

describe('resolverLegenda', () => {
  test('a mesma semente dá sempre a mesma legenda (retry-safe)', () => {
    const a = resolverLegenda(TPL, 'post1:contaA');
    const b = resolverLegenda(TPL, 'post1:contaA');
    expect(a).toBe(b);
  });

  test('cada grupo vira UMA das opções, sem sobrar chaves', () => {
    const r = resolverLegenda(TPL, 'post1:contaA');
    expect(r).not.toMatch(/[{}|]/);
    expect(r).toMatch(/^(Bom dia|Oi|E aí)! (salva|guarda) pra não perder$/);
  });

  test('contas diferentes produzem legendas diferentes', () => {
    const vistas = new Set();
    for (let i = 0; i < 12; i++) vistas.add(resolverLegenda(TPL, `post1:conta${i}`));
    expect(vistas.size).toBeGreaterThan(1);
  });

  test('sem chaves, devolve o texto intacto', () => {
    const txt = 'Legenda normal 🔥 #tag';
    expect(resolverLegenda(txt, 'post1:contaA')).toBe(txt);
  });

  test('grupo sem `|` não é escolha — fica como está', () => {
    // `{só isto}` não tem barra: não é um grupo de variação.
    expect(resolverLegenda('a {literal} b', 'sem')).toBe('a {literal} b');
  });

  test('chave sem fechamento não quebra', () => {
    expect(() => resolverLegenda('legenda { aberta', 'x')).not.toThrow();
    expect(resolverLegenda('legenda { aberta', 'x')).toBe('legenda { aberta');
  });

  test('null/undefined viram string vazia', () => {
    expect(resolverLegenda(null, 'x')).toBe('');
    expect(resolverLegenda(undefined, 'x')).toBe('');
  });

  test('só a semente muda a escolha — texto igual, sementes diferentes podem divergir', () => {
    const a = resolverLegenda('{x|y|z|w|v}', 'sA');
    const b = resolverLegenda('{x|y|z|w|v}', 'sB');
    // não é garantido divergirem em UM par, mas o conjunto abaixo tem de variar
    const todas = new Set(['sA','sB','sC','sD','sE'].map(s => resolverLegenda('{x|y|z|w|v}', s)));
    expect(todas.size).toBeGreaterThan(1);
    expect(['x','y','z','w','v']).toContain(a);
    expect(['x','y','z','w','v']).toContain(b);
  });
});

describe('o worker aplica a variação por conta', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(path.resolve(__dirname, '../src/queue/worker.js'), 'utf8');

  test('resolve a legenda com semente post+conta', () => {
    expect(fonte).toContain("require('../services/variarLegenda')");
    expect(fonte).toMatch(/resolverLegenda\(post\.caption, `\$\{post\._id\}:\$\{account\._id\}`\)/);
  });

  test('publica com a legenda resolvida, e antes do publish', () => {
    expect(fonte).toMatch(/caption:\s*legendaFinal/);
    const iResolve = fonte.indexOf('resolverLegenda(post.caption');
    const iPublish = fonte.indexOf('provider.publishReel(account, postParaPublicar)');
    expect(iResolve).toBeGreaterThan(0);
    expect(iPublish).toBeGreaterThan(0);
    expect(iResolve).toBeLessThan(iPublish);
  });
});

describe('temVariacao', () => {
  test('true quando há {a|b}, false sem', () => {
    expect(temVariacao('{oi|olá} tudo bem')).toBe(true);
    expect(temVariacao('sem variação')).toBe(false);
    expect(temVariacao('{sembarra}')).toBe(false);
  });

  test('não é estatal — chamar de novo dá o mesmo resultado', () => {
    // Um regex global compartilhado alternaria true/false para a mesma entrada.
    expect(temVariacao('{oi|olá}')).toBe(true);
    expect(temVariacao('{oi|olá}')).toBe(true);
  });
});
