'use strict';

/**
 * O aparelho virtual de cada conta.
 *
 * O vazamento: o serviço Python escolhia o modelo por `sha256(account_id) % N`
 * com N=5 — hoje o pool tem 102 combinações (67 modelos × versões de Android).
 * Determinístico — o que é certo, porque um celular que troca de
 * modelo entre dois logins é por si só um sinal — mas hash não garante
 * DISTINÇÃO.
 *
 * Medido com os usernames reais: três aparelhos para cinco contas. Dois pares
 * anunciavam o mesmo modelo, resolução, dpi e cpu, com a mesma build do app, a
 * mesma região e o mesmo IP.
 */

const { menosUsado, TOTAL_DE_APARELHOS } = require('../src/services/aparelhoDaConta');

describe('a alocação escolhe o menos usado', () => {
  test('com tudo livre, escolhe algum índice válido', () => {
    const c = new Array(TOTAL_DE_APARELHOS).fill(0);
    const i = menosUsado(c, 'conta1');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(TOTAL_DE_APARELHOS);
  });

  test('índice já usado é evitado enquanto houver livre', () => {
    /* É o que a alocação garante e o sorteio só torna provável. */
    const c = new Array(TOTAL_DE_APARELHOS).fill(1);
    c[7] = 0;
    expect(menosUsado(c, 'qualquer')).toBe(7);
  });

  test('cinco contas recebem cinco aparelhos distintos', () => {
    /* O defeito em uma frase: antes, estas mesmas cinco contas recebiam três
       aparelhos. */
    const contagem = new Array(TOTAL_DE_APARELHOS).fill(0);
    const escolhidos = [];
    for (const id of ['a1', 'b2', 'c3', 'd4', 'e5']) {
      const i = menosUsado(contagem, id);
      contagem[i]++;
      escolhidos.push(i);
    }
    expect(new Set(escolhidos).size).toBe(5);
  });

  test('o pool inteiro é coberto sem repetir', () => {
    const contagem = new Array(TOTAL_DE_APARELHOS).fill(0);
    const escolhidos = [];
    for (let n = 0; n < TOTAL_DE_APARELHOS; n++) {
      const i = menosUsado(contagem, `conta${n}`);
      contagem[i]++;
      escolhidos.push(i);
    }
    expect(new Set(escolhidos).size).toBe(TOTAL_DE_APARELHOS);
  });

  test('além do pool, a repetição é a mais espalhada possível', () => {
    // O dobro do pool: dois por aparelho, nenhum com três.
    const contagem = new Array(TOTAL_DE_APARELHOS).fill(0);
    for (let n = 0; n < TOTAL_DE_APARELHOS * 2; n++) {
      contagem[menosUsado(contagem, `c${n}`)]++;
    }
    expect(Math.max(...contagem)).toBe(2);
    expect(Math.min(...contagem)).toBe(2);
  });

  test('a escolha é estável para a mesma chave', () => {
    /* Precisa ser: se a alocação falhar de gravar e for refeita, o aparelho
       não pode mudar. */
    const c = new Array(TOTAL_DE_APARELHOS).fill(0);
    expect(menosUsado(c, 'x')).toBe(menosUsado(c, 'x'));
  });

  test('não é sequencial — o pool está agrupado por fabricante', () => {
    /* Pegando sempre o primeiro índice livre, as contas criadas em sequência
       receberiam Samsung, Samsung, Samsung — o catálogo está agrupado por
       fabricante. Espalhar pelo id evita isso sem sacrificar a distinção. */
    const c = new Array(TOTAL_DE_APARELHOS).fill(0);
    const tres = ['p1', 'p2', 'p3'].map(id => menosUsado(c, id));
    expect(tres).not.toEqual([0, 0, 0]);
    expect(new Set(tres).size).toBeGreaterThan(1);
  });
});

describe('o total bate com o do serviço Python', () => {
  test('o pool do Python tem o mesmo tamanho', () => {
    /* Os dois processos são separados, então o número é repetido. Um índice
       além do fim é ignorado pelo Python (cai no hash): degrada, não quebra —
       mas a divergência precisa ser detectável em vez de silenciosa. */
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../../instagrapi-service/app/session_pool.py'), 'utf8'
    );
    /* O pool do Python e o produto (modelo x versoes), montado em
       `_montar_pool()`. Contar as linhas do catalogo daria o numero de
       MODELOS, nao de combinacoes — sao coisas diferentes desde que a versao
       do Android virou um eixo. Somar as versoes declaradas reproduz a conta
       do outro lado. */
    const catalogo = fonte.slice(
      fonte.indexOf('_MODELOS = ['),
      fonte.indexOf('def _montar_pool'),
    );
    const combinacoes = [...catalogo.matchAll(/\[([0-9,{}\s]*?)\]\),/g)]
      .reduce((soma, m) => soma + m[1].split(',').filter(x => x.trim()).length, 0);
    expect(combinacoes).toBe(TOTAL_DE_APARELHOS);
  });
});

describe('a ligação com o serviço', () => {
  const fs = require('fs');
  const path = require('path');
  const cliente = fs.readFileSync(
    path.resolve(__dirname, '../src/services/instagrapi/InstagrapiHttpClient.js'), 'utf8'
  );

  test('o índice vai no login', () => {
    /* Um módulo pode estar perfeito e ninguém chamá-lo — foi o defeito do
       arquivo por conta. */
    expect(cliente).toContain('device_index:       deviceIndex');
  });

  test('o índice vai também no load', () => {
    /* Restaurar sessão cria o cliente do zero depois de um restart. Sem o
       índice, o aparelho voltaria ao hash e mudaria entre antes e depois do
       deploy. */
    const trecho = cliente.slice(cliente.indexOf("'/session/load'"));
    expect(trecho.slice(0, 700)).toContain('device_index');
  });

  test('o campo existe no schema, senão o Mongoose descarta', () => {
    const Account = require('../src/models/Account');
    expect(Account.schema.paths).toHaveProperty('deviceIndex');
    expect(Account.schema.paths.deviceIndex.defaultValue).toBeNull();
  });
});

describe('o catálogo do Python só pode CRESCER pelo fim', () => {
  /**
   * A trava que faltava, e que existe por um erro concreto.
   *
   * Ao expandir o pool de 50 para 102, ancorei o bloco novo numa entrada do
   * Pixel 7 achando que era a última linha do catálogo. Não era — havia mais
   * modelos depois. O resultado: do índice 45 em diante, todo aparelho mudou.
   *
   * Numa base com centenas de contas isso troca o celular de todas elas de uma
   * vez, que é exatamente o sinal que o aparelho fixo por conta existe para
   * evitar. E não haveria erro, nem log: o login seguiria funcionando, só que
   * anunciando outro aparelho.
   *
   * Peguei conferindo à mão antes do commit. Este teste é para a próxima vez,
   * quando ninguém estiver conferindo.
   *
   * ── Como atualizar quando o pool crescer de novo
   *
   * Não mude a IMPRESSÃO abaixo para "fazer passar" — ela é o valor do
   * prefixo, e alterá-la anula o teste. Se ele reprovar, o catálogo foi
   * editado no meio: mova a sua adição para o fim do arquivo.
   */
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  /** Reproduz `_montar_pool()`: o produto (modelo × versões), na ordem. */
  function poolDoPython() {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../../instagrapi-service/app/session_pool.py'), 'utf8'
    );
    const mapa = {};
    for (const m of fonte.match(/_ANDROID = \{([^}]*)\}/)[1].matchAll(/(\d+):\s*"([\d.]+)"/g)) {
      mapa[m[1]] = m[2];
    }
    const catalogo = fonte.slice(fonte.indexOf('_MODELOS = ['), fonte.indexOf('def _montar_pool'));
    const saida = [];
    for (const linha of catalogo.split('\n')) {
      const l = linha.trim();
      if (!l.startsWith('(')) continue;
      const campos = [...l.matchAll(/"([^"]*)"/g)].map(m => m[1]);
      const versoes = l.match(/\[([0-9,\s]+)\]/);
      if (campos.length < 6 || !versoes) continue;
      const [fab, code, modelo, cpu, dpi, res] = campos;
      for (const api of versoes[1].split(',')) {
        saida.push([mapa[api.trim()] || '?', dpi, res, fab, code, modelo, cpu].join('|'));
      }
    }
    return saida;
  }

  /* Congelado com o pool em 50, medido no arquivo. */
  const PREFIXO_CONGELADO = 50;
  /* Conferido de dois jeitos antes de congelar: (a) o prefixo é idêntico ao
     que estava em `git HEAD` antes da expansão, e (b) este leitor em JS produz
     exatamente a mesma lista que um leitor independente em Python. Congelar um
     valor sem essa dupla conferência seria congelar uma leitura errada.

     ── Recongelado em 12/09/2026, de propósito

     Era `57dbf48732de4a1b`. Três posições do prefixo (23, 24 e 25) tiveram o
     HARDWARE corrigido em campo — "moto g73 5G / rhodep / mt6833" era um
     aparelho que não existe (codinome do g52, chipset de nenhum dos dois), e
     o g73 de verdade já estava mais abaixo com outro hardware: o mesmo modelo
     com dois hardwares é aparelho implausível, que é sinal. Posições e
     contagem de versões não mudaram — nenhum índice se deslocou. As contas
     que estavam nesses três índices trocam de celular UMA vez, para um que
     existe. Foi essa a troca aceita, e é por isso que este número mudou. */
  const IMPRESSAO = '8d5bdd333b73cbfa';

  test('as 50 primeiras combinações continuam exatamente onde estavam', () => {
    const pool = poolDoPython();
    expect(pool.length).toBeGreaterThanOrEqual(PREFIXO_CONGELADO);

    const digital = crypto.createHash('sha256')
      .update(JSON.stringify(pool.slice(0, PREFIXO_CONGELADO)))
      .digest('hex').slice(0, 16);

    if (digital !== IMPRESSAO) {
      throw new Error(
        `O catálogo de aparelhos foi editado NO MEIO: o prefixo mudou de ` +
        `${IMPRESSAO} para ${digital}. Toda conta com deviceIndex nesse trecho ` +
        `passa a entrar de outro celular. Mova a sua adição para o FIM de _MODELOS.`
      );
    }
  });

  test('o pool só cresce — nunca encolhe abaixo do prefixo congelado', () => {
    /* Remover um modelo é a outra forma de deslocar tudo, e some sem erro:
       o Python ignora índice além do fim e cai no hash. */
    expect(poolDoPython().length).toBeGreaterThanOrEqual(PREFIXO_CONGELADO);
  });
});
