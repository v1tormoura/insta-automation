'use strict';

/**
 * O aparelho virtual de cada conta.
 *
 * O vazamento: o serviço Python escolhia o modelo por `sha256(account_id) % N`
 * com N=5. Determinístico — o que é certo, porque um celular que troca de
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
    /* É o que a alocação garante e o sorteio só torna provável: com 23 modelos
       e 5 contas, cinco sorteios colidem em ~40% das vezes. */
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

  test('vinte e três contas cobrem o pool inteiro sem repetir', () => {
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
    // 46 contas em 23 modelos: dois por modelo, nenhum com três.
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
       receberiam Samsung, Samsung, Samsung. Espalhar pelo id evita isso sem
       sacrificar a distinção. */
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
    const bloco = fonte.slice(
      fonte.indexOf('_REAL_ANDROID_DEVICES = ['),
      fonte.indexOf('\n]\n', fonte.indexOf('_REAL_ANDROID_DEVICES = ['))
    );
    const quantos = (bloco.match(/"model":/g) || []).length;
    expect(quantos).toBe(TOTAL_DE_APARELHOS);
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
