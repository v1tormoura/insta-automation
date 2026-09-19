'use strict';

/**
 * Publicações por conta em 24 horas.
 *
 * ── Por que este número não ganhou um campo novo
 *
 * Ele já existe: `Account.dailyPostLimit`. Dois lugares testados o obedecem — o
 * `publicationPlanner`, que nem gera publicação além do teto, e o
 * `checkDailyLimit` na execução. Um segundo número no job daria duas respostas
 * para "quantas esta conta pode hoje", e a divergência apareceria como
 * publicação que o painel promete e a execução recusa.
 *
 * ── O que quebra calado aqui
 *
 *   `Number(null)` é 0        → campo vazio viraria teto 0, e a conta pararia
 *                               de publicar sem ninguém ter pedido isso
 *   teto gravado sem pedido   → escrever um padrão apaga o ajuste de quem já
 *                               configurou a conta à mão
 *   falha do banco propagada  → perder a publicação por causa de um ajuste de
 *                               ritmo é troca ruim
 *   aviso desalinhado         → se a faixa segura do `ritmoDaConta` mudar e a
 *                               linha do aviso não, a tela avisa errado
 */

jest.mock('../src/models/Account', () => ({ updateMany: jest.fn() }));

const Account = require('../src/models/Account');
const { normalizarTeto, acimaDoSeguro, aplicarNasContas, SEGURO_MAX, MAXIMO } = require('../src/services/tetoDiario');

beforeEach(() => {
  jest.clearAllMocks();
  Account.updateMany.mockResolvedValue({ modifiedCount: 2 });
});

describe('o valor pedido, normalizado', () => {
  test('número utilizável passa', () => {
    expect(normalizarTeto(10)).toBe(10);
    expect(normalizarTeto('24')).toBe(24);
    expect(normalizarTeto(6.4)).toBe(6);
    expect(normalizarTeto(6.6)).toBe(7);
  });

  test('ausente é null, não um padrão', () => {
    /* Quem não mandou o campo não quer mexer no teto das contas. Escrever um
       padrão apagaria o ajuste de quem já configurou à mão. */
    for (const v of [undefined, null, '', '   ', {}, [], NaN, 'muito']) {
      expect(normalizarTeto(v)).toBeNull();
    }
  });

  test('zero e negativo são null, não teto zero', () => {
    /* `Number(null)` e `Number('')` são 0 e passariam por `isFinite`. Teto 0
       faria a conta parar de publicar sem ninguém ter pedido. */
    expect(normalizarTeto(0)).toBeNull();
    expect(normalizarTeto(-5)).toBeNull();
    expect(normalizarTeto('0')).toBeNull();
  });

  test('acima do máximo é aparado, não recusado', () => {
    /* Aparar é melhor que recusar: quem digitou 500 quer o máximo, não um
       erro. E 48 já é uma publicação a cada 30 min sem parar. */
    expect(normalizarTeto(500)).toBe(MAXIMO);
    expect(normalizarTeto(MAXIMO)).toBe(MAXIMO);
  });
});

describe('o aviso da faixa segura', () => {
  test('dentro da faixa não avisa', () => {
    expect(acimaDoSeguro(6)).toBe(false);
    expect(acimaDoSeguro(SEGURO_MAX)).toBe(false);
  });

  test('acima da faixa avisa', () => {
    expect(acimaDoSeguro(SEGURO_MAX + 1)).toBe(true);
    expect(acimaDoSeguro(24)).toBe(true);
    expect(acimaDoSeguro(48)).toBe(true);
  });

  test('valor ausente não avisa', () => {
    /* Não pedir nada não é pedir algo perigoso. */
    expect(acimaDoSeguro(null)).toBe(false);
    expect(acimaDoSeguro(undefined)).toBe(false);
  });

  test('a linha do aviso bate com a faixa do ritmoDaConta', () => {
    /* O teto padrão está DESLIGADO, então este número não espelha mais uma
       regra ativa: ele espelha a faixa recomendada que o cabeçalho do
       ritmoDaConta documenta para religar (TETO_DIARIO_PADRAO=6-10). Se a
       recomendação mudar e este aviso não, a tela passa a avisar errado. */
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(path.resolve(__dirname, '../src/services/ritmoDaConta.js'), 'utf8');
    const achado = Number(fonte.match(/TETO_DIARIO_PADRAO=\d+-(\d+)/)?.[1]);
    expect(achado).toBe(SEGURO_MAX);
  });
});

describe('gravar nas contas', () => {
  const IDS = ['64b000000000000000000001', '64b000000000000000000002'];

  test('grava o teto nas contas pedidas', async () => {
    const n = await aplicarNasContas(IDS, 24);
    expect(n).toBe(2);
    expect(Account.updateMany).toHaveBeenCalledWith(
      { _id: { $in: IDS } },
      { $set: { dailyPostLimit: 24 } },
    );
  });

  test('grava no campo que o resto do sistema já obedece', async () => {
    /* Se este campo mudar de nome aqui, o planejador e a verificação de
       publicação continuariam lendo o antigo — e o teto viraria enfeite. */
    await aplicarNasContas(IDS, 10);
    const patch = Account.updateMany.mock.calls[0][1].$set;
    expect(Object.keys(patch)).toEqual(['dailyPostLimit']);
  });

  test('sem teto pedido não toca o banco', async () => {
    expect(await aplicarNasContas(IDS, undefined)).toBe(0);
    expect(await aplicarNasContas(IDS, '')).toBe(0);
    expect(Account.updateMany).not.toHaveBeenCalled();
  });

  test('sem contas não toca o banco', async () => {
    expect(await aplicarNasContas([], 24)).toBe(0);
    expect(await aplicarNasContas(null, 24)).toBe(0);
    expect(Account.updateMany).not.toHaveBeenCalled();
  });

  test('ids vazios são descartados antes da consulta', async () => {
    await aplicarNasContas([IDS[0], null, '', undefined], 12);
    expect(Account.updateMany.mock.calls[0][0]).toEqual({ _id: { $in: [IDS[0]] } });
  });

  test('falha do banco não propaga', async () => {
    /* Perder a publicação por causa de um ajuste de ritmo seria troca ruim. O
       teto anterior continua valendo, e é um teto. */
    Account.updateMany.mockRejectedValue(new Error('sem conexão'));
    await expect(aplicarNasContas(IDS, 24)).resolves.toBe(0);
  });

  test('resposta antiga do Mongo também é contada', async () => {
    /* Driver mais velho devolve `nModified` em vez de `modifiedCount`. Sem os
       dois, o log diria 0 contas atualizadas depois de atualizar duas. */
    Account.updateMany.mockResolvedValue({ nModified: 3 });
    expect(await aplicarNasContas(IDS, 24)).toBe(3);
  });
});

describe('a ligação com a tela e com o Postar', () => {
  const fs = require('fs');
  const path = require('path');
  const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('o Postar aplica o teto antes de criar o job', () => {
    /* Depois de criar, a primeira rodada poderia consultar o teto antigo. */
    const c = ler('../src/controllers/postController.js');
    expect(c.indexOf('aplicarTetoDiario')).toBeLessThan(c.indexOf('await Job.create'));
  });

  /* ── O campo saiu da tela, e é assim que tem de ser ─────────────────────
     Estes dois testes exigiam que o Postar enviasse `postsPor24h`. O campo foi
     REMOVIDO da tela a pedido de quem opera: ele escrevia em
     `Account.dailyPostLimit`, ou seja, mexia na configuração DAS CONTAS a
     partir de um envio — efeito colateral que surpreendia.

     Sem o campo, `ritmoDaConta` volta a mandar sozinho: sorteia de 6 a 10 por
     conta e por dia. É o comportamento seguro, e é o que o teste abaixo trava —
     junto com a garantia de que o backend aguenta a ausência do campo sem
     zerar o teto de ninguém. */
  test('a tela NÃO manda mais o campo (o teto fica com o ritmoDaConta)', () => {
    expect(ler('../../frontend/src/pages/Posts.jsx')).not.toContain("form.append('postsPor24h'");
  });

  test('sem o campo, o teto das contas não é tocado', () => {
    /* `null` e não um padrão: quem não mandou o campo não quer mexer no teto,
       e escrever um padrão ali apagaria o ajuste de quem já configurou. */
    expect(normalizarTeto(undefined)).toBeNull();
    expect(normalizarTeto('')).toBeNull();
    expect(normalizarTeto(null)).toBeNull();
  });
});
