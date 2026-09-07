'use strict';

/**
 * A ordem em que as mídias entram na fila.
 *
 * ── O defeito que existia antes de haver opção
 *
 * `Media.find({ _id: { $in: ids } })` não devolve na ordem dos ids. Quem
 * escolhia quarenta vídeos numa ordem via a fila sair em outra, e não havia
 * nada na tela que explicasse. Qualquer opção de ordem construída em cima disso
 * seria decorativa.
 *
 * ── O que mais quebra calado aqui
 *
 *   sort com Math.random    → não é permutação uniforme; os primeiros ficam
 *                             quase nos primeiros, e "embaralhado" que preserva
 *                             o começo não é embaralhado
 *   aleatória sem semente   → a ordem muda a cada execução do mesmo job, e o
 *                             histórico não fecha com o que aconteceu
 *   NaN na comparação       → data inválida envenena a ordenação inteira, que
 *                             passa a sair arbitrária
 *   empate não desfeito     → envio em lote grava o mesmo segundo em vinte
 *                             mídias, e elas trocam de lugar entre execuções
 */

const {
  ordenar, naOrdemDosIds, embaralhar, sementeDe, ORDENS, ORDEM_PADRAO,
} = require('../src/services/ordemDasMidias');

/** Mídia da biblioteca, com data. */
const m = (filename, iso) => ({ filename, quando: iso ? new Date(iso) : null });

describe('a ordem dos ids é restaurada', () => {
  test('devolve na ordem pedida, não na que o Mongo entregou', () => {
    /* O defeito em uma frase: o usuário escolhe c, a, b e a fila sai a, b, c. */
    const docs = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];
    expect(naOrdemDosIds(docs, ['c', 'a', 'b']).map(d => d._id)).toEqual(['c', 'a', 'b']);
  });

  test('id sem documento some da fila em vez de virar item quebrado', () => {
    /* Mídia apagada entre a escolha e o envio. Um `undefined` na fila viraria
       um post sem arquivo, que falha lá na frente sem dizer por quê. */
    const docs = [{ _id: 'a' }];
    expect(naOrdemDosIds(docs, ['a', 'sumiu'])).toHaveLength(1);
  });

  test('compara como texto — ObjectId não é igual a string por ===', () => {
    /* `_id` chega como ObjectId e os ids do corpo chegam como string. Sem o
       String() dos dois lados, o Map nunca casaria e a fila sairia vazia. */
    const docs = [{ _id: { toString: () => 'abc123' } }];
    expect(naOrdemDosIds(docs, ['abc123'])).toHaveLength(1);
  });

  test('entradas vazias não explodem', () => {
    expect(naOrdemDosIds(null, null)).toEqual([]);
    expect(naOrdemDosIds([], ['a'])).toEqual([]);
    expect(naOrdemDosIds([{ _id: 'a' }], [])).toEqual([]);
  });
});

describe('mais antigos primeiro, mais recentes primeiro', () => {
  const tres = [
    m('meio.mp4',    '2026-05-10T12:00:00Z'),
    m('antigo.mp4',  '2026-01-01T12:00:00Z'),
    m('recente.mp4', '2026-09-01T12:00:00Z'),
  ];

  test('antigos primeiro é o padrão', () => {
    expect(ORDEM_PADRAO).toBe('antigos_primeiro');
    expect(ordenar(tres).map(x => x.filename))
      .toEqual(['antigo.mp4', 'meio.mp4', 'recente.mp4']);
  });

  test('recentes primeiro inverte', () => {
    /* É o caso que a tela descreve: subiu 400 vídeos e quer postar os novos. */
    expect(ordenar(tres, { ordem: 'recentes_primeiro' }).map(x => x.filename))
      .toEqual(['recente.mp4', 'meio.mp4', 'antigo.mp4']);
  });

  test('ordem desconhecida cai no padrão em vez de sair arbitrária', () => {
    for (const ordem of ['bagunca', '', null, 42, { $ne: null }]) {
      expect(ordenar(tres, { ordem }).map(x => x.filename))
        .toEqual(['antigo.mp4', 'meio.mp4', 'recente.mp4']);
    }
  });

  test('"selecao" mantém exatamente como veio', () => {
    expect(ordenar(tres, { ordem: 'selecao' }).map(x => x.filename))
      .toEqual(['meio.mp4', 'antigo.mp4', 'recente.mp4']);
    expect(ORDENS).toContain('selecao');
  });

  test('empate mantém a ordem da escolha', () => {
    /* Envio em lote grava o mesmo instante em muitas mídias. Sem desempate por
       índice, elas trocariam de lugar entre execuções — e o usuário veria uma
       ordem diferente a cada vez sem ter mudado nada. */
    const mesmoSegundo = ['a', 'b', 'c', 'd'].map(n => m(`${n}.mp4`, '2026-03-03T03:03:03Z'));
    expect(ordenar(mesmoSegundo, { ordem: 'antigos_primeiro' }).map(x => x.filename))
      .toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4']);
    expect(ordenar(mesmoSegundo, { ordem: 'recentes_primeiro' }).map(x => x.filename))
      .toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4']);
  });

  test('upload sem data conta como recém-enviado', () => {
    /* Arquivo que acabou de subir não tem histórico na biblioteca. Tratá-lo
       como o mais recente é o que corresponde ao fato. */
    const mix = [m('subiu_agora.mp4', null), m('velho.mp4', '2020-01-01T00:00:00Z')];
    expect(ordenar(mix, { ordem: 'antigos_primeiro' }).map(x => x.filename))
      .toEqual(['velho.mp4', 'subiu_agora.mp4']);
  });

  test('data inválida não envenena a comparação', () => {
    /* NaN em qualquer comparação a torna falsa, e a ordenação inteira sai
       arbitrária — inclusive para as mídias com data boa. */
    const comLixo = [
      { filename: 'lixo.mp4',  quando: 'não é data' },
      m('antigo.mp4', '2020-01-01T00:00:00Z'),
      m('novo.mp4',   '2026-01-01T00:00:00Z'),
    ];
    const saida = ordenar(comLixo, { ordem: 'antigos_primeiro' }).map(x => x.filename);
    expect(saida.slice(0, 2)).toEqual(['antigo.mp4', 'novo.mp4']);
    expect(saida).toHaveLength(3);
  });

  test('nunca devolve o array original', () => {
    /* Quem chama costuma guardar a lista de entrada para o relatório. Ordenar
       no lugar mudaria a lista dele sem avisar. */
    const entrada = [...tres];
    const saida = ordenar(entrada, { ordem: 'recentes_primeiro' });
    expect(saida).not.toBe(entrada);
    expect(entrada.map(x => x.filename)).toEqual(['meio.mp4', 'antigo.mp4', 'recente.mp4']);
  });

  test('lista de zero ou um item passa sem drama', () => {
    expect(ordenar([])).toEqual([]);
    expect(ordenar(null)).toEqual([]);
    expect(ordenar([m('so.mp4', '2026-01-01T00:00:00Z')])).toHaveLength(1);
  });

  test('nulos na lista são descartados', () => {
    expect(ordenar([null, m('a.mp4', '2026-01-01T00:00:00Z'), undefined])).toHaveLength(1);
  });
});

describe('ordem aleatória', () => {
  const vinte = Array.from({ length: 20 }, (_, i) => m(`v${String(i).padStart(2, '0')}.mp4`, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`));

  test('a mesma semente dá sempre a mesma ordem', () => {
    /* Sem isto, o mesmo job reexecutado embaralharia diferente e o histórico
       não fecharia com o que foi postado. */
    const a = ordenar(vinte, { aleatoria: true, semente: 'job-123' }).map(x => x.filename);
    const b = ordenar(vinte, { aleatoria: true, semente: 'job-123' }).map(x => x.filename);
    expect(a).toEqual(b);
  });

  test('sementes diferentes dão ordens diferentes', () => {
    const a = ordenar(vinte, { aleatoria: true, semente: 'job-123' }).map(x => x.filename);
    const b = ordenar(vinte, { aleatoria: true, semente: 'job-999' }).map(x => x.filename);
    expect(a).not.toEqual(b);
  });

  test('embaralha de verdade, não só encosta', () => {
    /* O defeito clássico: `sort(() => Math.random() - 0.5)` não é permutação
       uniforme e mantém os primeiros quase nos primeiros. Aqui se mede o
       deslocamento: numa permutação real, poucos itens ficam onde estavam. */
    const original = vinte.map(x => x.filename);
    const saida = ordenar(vinte, { aleatoria: true, semente: 'medida' }).map(x => x.filename);
    const noLugar = saida.filter((f, i) => f === original[i]).length;
    expect(noLugar).toBeLessThan(5);
  });

  test('não perde nem duplica nenhuma mídia', () => {
    const saida = ordenar(vinte, { aleatoria: true, semente: 'x' }).map(x => x.filename);
    expect(saida).toHaveLength(20);
    expect(new Set(saida).size).toBe(20);
  });

  test('aleatória ganha da ordem escolhida', () => {
    /* A tela promete: "sem marcar, segue a ordem escolhida acima". Logo,
       marcada, a ordem acima não vale. */
    const comOrdem = ordenar(vinte, { aleatoria: true, ordem: 'recentes_primeiro', semente: 's' }).map(x => x.filename);
    const soAleatoria = ordenar(vinte, { aleatoria: true, semente: 's' }).map(x => x.filename);
    expect(comOrdem).toEqual(soAleatoria);
  });

  test('cobre todas as posições ao longo de muitas sementes', () => {
    /* Um embaralhamento enviesado deixaria posições inalcançáveis para o
       primeiro item. Com Fisher-Yates uniforme, ele passa por toda parte. */
    const posicoes = new Set();
    for (let s = 0; s < 200; s++) {
      const saida = ordenar(vinte, { aleatoria: true, semente: `s${s}` });
      posicoes.add(saida.findIndex(x => x.filename === 'v00.mp4'));
    }
    expect(posicoes.size).toBeGreaterThan(15);
  });

  test('embaralhar sozinho é determinístico pela semente', () => {
    const s = sementeDe('igual');
    expect(embaralhar([1, 2, 3, 4, 5], s)).toEqual(embaralhar([1, 2, 3, 4, 5], s));
  });

  test('a semente é estável e não depende de objeto', () => {
    expect(sementeDe('abc')).toBe(sementeDe('abc'));
    expect(sementeDe('abc')).not.toBe(sementeDe('abd'));
    /* Sem semente e sem texto, ainda precisa produzir número — não NaN, que
       faria o PRNG devolver sempre o mesmo valor. */
    expect(Number.isInteger(sementeDe(undefined))).toBe(true);
    expect(Number.isInteger(sementeDe(null))).toBe(true);
  });
});
