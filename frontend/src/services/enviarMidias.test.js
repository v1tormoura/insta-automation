import { describe, expect, test } from 'vitest';
import { montarLotes, avisoDeRecusados } from './enviarMidias';

const MB = 1024 * 1024;
const arq = (name, mb) => ({ name, size: mb * MB });

describe('montarLotes — cada requisição abaixo do limite da Cloudflare', () => {
  test('arquivos pequenos vão juntos num lote só', () => {
    const { lotes, recusados } = montarLotes([arq('a', 10), arq('b', 20), arq('c', 30)], 95 * MB);
    expect(lotes.map(l => l.map(f => f.name))).toEqual([['a', 'b', 'c']]);
    expect(recusados).toEqual([]);
  });

  test('passando do limite, abre outro lote — sem mudar a ordem', () => {
    const { lotes } = montarLotes([arq('a', 60), arq('b', 40), arq('c', 50), arq('d', 10)], 95 * MB);
    expect(lotes.map(l => l.map(f => f.name))).toEqual([['a'], ['b', 'c'], ['d']]);
    for (const l of lotes) expect(l.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(95 * MB);
  });

  test('arquivo sozinho acima do limite é recusado, e os outros seguem', () => {
    const { lotes, recusados } = montarLotes([arq('a', 10), arq('grande', 150), arq('b', 10)], 95 * MB);
    expect(lotes.map(l => l.map(f => f.name))).toEqual([['a', 'b']]);
    expect(recusados.map(f => f.name)).toEqual(['grande']);
    expect(avisoDeRecusados(recusados)).toContain('grande (150 MB)');
  });

  test('exatamente no limite cabe', () => {
    const { lotes, recusados } = montarLotes([arq('a', 95)], 95 * MB);
    expect(lotes).toHaveLength(1);
    expect(recusados).toHaveLength(0);
  });

  test('nada para enviar não gera requisição', () => {
    expect(montarLotes([])).toEqual({ lotes: [], recusados: [] });
    expect(avisoDeRecusados([])).toBe('');
  });
});
