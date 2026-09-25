import { describe, expect, test } from 'vitest';
import { montarLotes } from './enviarMidias';

const MB = 1024 * 1024;
const arq = (name, mb) => ({ name, size: mb * MB });
const nomes = lotes => lotes.map(l => l.map(f => f.name));

describe('montarLotes', () => {
  test('arquivos pequenos vão juntos num lote só', () => {
    expect(nomes(montarLotes([arq('a', 10), arq('b', 20), arq('c', 30)], 95 * MB))).toEqual([['a', 'b', 'c']]);
  });

  test('passando do limite, abre outro lote — sem mudar a ordem', () => {
    expect(nomes(montarLotes([arq('a', 60), arq('b', 40), arq('c', 50), arq('d', 10)], 95 * MB)))
      .toEqual([['a'], ['b', 'c'], ['d']]);
  });

  test('arquivo maior que o lote vai sozinho, nunca é descartado', () => {
    expect(nomes(montarLotes([arq('a', 10), arq('grande', 300), arq('b', 10)], 95 * MB)))
      .toEqual([['a'], ['grande'], ['b']]);
  });

  test('nada para enviar não gera requisição', () => {
    expect(montarLotes([])).toEqual([]);
  });
});
