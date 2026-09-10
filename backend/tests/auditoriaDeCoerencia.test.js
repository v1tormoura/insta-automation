'use strict';

/**
 * Auditoria de coerência.
 *
 * ── O que estes testes protegem
 *
 * O relatório existe para ser confiado sem conferir. Duas formas de ele
 * mentir, e as duas são silenciosas:
 *
 *   1. INVENTAR colisão — juntar contas por um campo ausente. Duas contas sem
 *      IP conhecido não estão "no mesmo IP": está faltando informação. Um
 *      relatório que trata `undefined` como valor acusa a frota inteira e vira
 *      ruído que ninguém lê.
 *
 *   2. VAZAR a credencial do proxy — o campo `proxy` carrega usuário e senha
 *      do fornecedor. Ele precisa ser lido para saber se existe, e não pode
 *      sair na resposta.
 */

const auditoria = require('../src/services/auditoriaDeCoerencia');
const { repetidos, regiaoConfigurada, emTexto } = auditoria;

describe('agrupamento: só conta o que tem valor', () => {
  test('agrupa quem repete e ignora quem é único', () => {
    const r = repetidos(
      [{ username: 'a', ip: '1.1.1.1' }, { username: 'b', ip: '1.1.1.1' }, { username: 'c', ip: '2.2.2.2' }],
      x => x.ip);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ valor: '1.1.1.1', quantas: 2 });
    expect(r[0].contas.sort()).toEqual(['a', 'b']);
  });

  test('campo AUSENTE não vira colisão', () => {
    /* O defeito que este teste existe para impedir: três contas sem IP
       conhecido seriam agrupadas sob `undefined` e o relatório diria
       "3 contas no mesmo IP" — uma acusação inventada a partir de dado que
       falta. */
    const r = repetidos(
      [{ username: 'a' }, { username: 'b', ip: null }, { username: 'c', ip: '' }],
      x => x.ip);
    expect(r).toEqual([]);
  });

  test('ordena da maior colisão para a menor', () => {
    const r = repetidos(
      [{ u: 'a', ip: 'x' }, { u: 'b', ip: 'x' }, { u: 'c', ip: 'x' },
       { u: 'd', ip: 'y' }, { u: 'e', ip: 'y' }],
      x => x.ip);
    expect(r.map(g => g.quantas)).toEqual([3, 2]);
  });
});

describe('a região espelha o serviço Python', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  test('os padrões são os mesmos do aplicar_regiao()', () => {
    delete process.env.INSTAGRAPI_COUNTRY;
    delete process.env.INSTAGRAPI_LOCALE;
    delete process.env.INSTAGRAPI_TZ_NAME;
    const r = regiaoConfigurada();
    expect(r).toMatchObject({ pais: 'BR', idioma: 'pt_BR', fusoNome: 'America/Sao_Paulo' });
  });

  test('os nomes de variável batem com os que o Python lê', () => {
    /* Dois processos, duas leituras das mesmas variáveis. Divergir aqui faria
       o relatório descrever uma configuração que não é a que está rodando —
       pior que não ter relatório. */
    const fs = require('fs');
    const path = require('path');
    const py = fs.readFileSync(
      path.resolve(__dirname, '../../instagrapi-service/app/session_pool.py'), 'utf8');
    for (const nome of ['INSTAGRAPI_COUNTRY', 'INSTAGRAPI_LOCALE',
                        'INSTAGRAPI_TZ_NAME', 'INSTAGRAPI_TZ_OFFSET_HOURS']) {
      expect(py).toContain(nome);
    }
  });

  test('a região é global, e o relatório diz isso', () => {
    expect(regiaoConfigurada().porConta).toBe(false);
  });
});

describe('o relatório não vaza a credencial do proxy', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(
    path.resolve(__dirname, '../src/services/auditoriaDeCoerencia.js'), 'utf8');

  test('`proxy` é lido, mas só `proxyIp` sai no relatório', () => {
    /* A âncora é a SINTAXE de acesso ao campo, não a palavra solta: `proxy`
       aparece de propósito em comentários explicando justamente isto, e uma
       asserção sobre a palavra casaria com eles. Já errei assim quatro vezes
       neste projeto. */
    expect(fonte).toMatch(/\.select\('username deviceIndex proxy proxyIp/);
    expect(fonte).not.toMatch(/proxy:\s*c\.proxy\b/);
    expect(fonte).not.toMatch(/\bproxy:\s*[a-z]+\.proxy[,}\s]/);
  });

  test('o texto do relatório nunca imprime o campo proxy', () => {
    const r = {
      ok: true, total: 2,
      regiao: { pais: 'BR', idioma: 'pt_BR', fusoNome: 'America/Sao_Paulo' },
      pool: { aparelhosEmUso: 2, contasPorAparelho: 1 },
      achados: {
        aparelhoEip: [], mesmoIp: [],
        semProxy: { quantas: 0, contas: [] }, mesmoAparelho: [],
      },
      naoVerificado: [],
    };
    const texto = emTexto(r);
    expect(texto).not.toMatch(/http:\/\/|socks5|:\/\/.*:.*@/);
  });
});

describe('o texto é legível mesmo sem achado nenhum', () => {
  const base = {
    ok: true, total: 3,
    regiao: { pais: 'BR', idioma: 'pt_BR', fusoNome: 'America/Sao_Paulo' },
    pool: { aparelhosEmUso: 3, contasPorAparelho: 1 },
    achados: { aparelhoEip: [], mesmoIp: [], semProxy: { quantas: 0, contas: [] }, mesmoAparelho: [] },
    naoVerificado: ['algo pendente'],
  };

  test('frota limpa mostra visto em tudo', () => {
    const t = emTexto(base);
    expect(t).toContain('✓ mesmo APARELHO e mesmo IP');
    expect(t).toContain('✓ sem proxy: nenhuma');
    expect(t).toContain('Não verificado:');
  });

  test('sem banco, diz que não deu — em vez de fingir frota limpa', () => {
    /* Um relatório vazio e um relatório impossível de gerar são coisas
       diferentes, e mostrar os dois iguais faria "nenhum problema" significar
       "não consegui olhar". */
    expect(emTexto({ ok: false, motivo: 'sem banco' })).toMatch(/indisponível/i);
  });

  test('lista longa é truncada, com a contagem do que sobrou', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => ({ valor: `ip${i}`, contas: ['a', 'b'], quantas: 2 }));
    const t = emTexto({ ...base, achados: { ...base.achados, mesmoIp: muitos } });
    expect(t).toContain('e mais 4');
  });
});

describe('a rota existe e oferece o formato de terminal', () => {
  const fs = require('fs');
  const path = require('path');
  const rota = fs.readFileSync(
    path.resolve(__dirname, '../src/routes/healthRoutes.js'), 'utf8');

  test('GET /health/coerencia', () => {
    expect(rota).toMatch(/router\.get\('\/coerencia'/);
  });

  test('`?formato=texto` devolve texto puro', () => {
    /* Quem está no SSH não quer garimpar JSON. */
    expect(rota).toMatch(/formato === 'texto'/);
    expect(rota).toMatch(/type\('text\/plain'\)/);
  });
});
