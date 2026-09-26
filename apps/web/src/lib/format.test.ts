import { describe, expect, it } from 'vitest';
import { formatBytes, formatCompact, formatDuration, formatMinutes } from './format';
import { oauthErrorMessage } from './labels';

describe('formatação', () => {
  it('números compactos em pt-BR', () => {
    expect(formatCompact(1284)).toBe('1.284');
    expect(formatCompact(12_900)).toMatch(/12,9\s?mil/);
    expect(formatCompact(null)).toBe('—');
  });

  it('bytes, duração e minutos', () => {
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatMinutes(0)).toBe('sem intervalo');
    expect(formatMinutes(90)).toBe('1h 30min');
  });

  it('erros do OAuth têm mensagem própria e fallback', () => {
    expect(oauthErrorMessage('access_denied')).toMatch(/cancelada/);
    expect(oauthErrorMessage('qualquer')).toMatch(/Não foi possível/);
  });
});
