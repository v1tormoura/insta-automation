import { describe, expect, test } from 'vitest';
import {
  CONFIG_PADRAO, tipoLocal, problemaLocal, duracaoUtil, estimarSegundos, resumoDaConfig,
  filtroCss, selecionarIntervalo, validadeRestante, tamanho,
} from './variacoes';

const arq = (name, type, size = 1000) => ({ name, type, size });

describe('variações de mídia — contas da tela', () => {
  test('tipo e problemas antes de enviar', () => {
    expect(tipoLocal(arq('a.MOV', ''))).toBe('video');
    expect(tipoLocal(arq('a.jpeg', 'image/jpeg'))).toBe('imagem');
    expect(tipoLocal(arq('a.gif', 'image/gif'))).toBeNull();
    const limites = { videoMb: 1, imagemMb: 1, duracaoS: 60 };
    expect(problemaLocal(arq('a.gif', 'image/gif'), { limites })).toMatch(/não suportado/);
    expect(problemaLocal(arq('a.jpg', 'image/jpeg'), { aplicarEm: 'video', limites })).toMatch(/só vídeos/);
    expect(problemaLocal(arq('a.mp4', 'video/mp4', 2 * 1024 * 1024), { limites })).toMatch(/Maior que 1 MB/);
    expect(problemaLocal(arq('a.mp4', 'video/mp4'), { limites, duracao: 90 })).toMatch(/Mais de 1 min/);
    expect(problemaLocal(arq('a.mp4', 'video/mp4'), { limites, duracao: 30 })).toBe('');
  });

  test('trecho só conta no modo avançado', () => {
    const avancado = { ...CONFIG_PADRAO, modo: 'avancado', trecho: { inicio: 5, fim: 20 } };
    expect(duracaoUtil(60, avancado)).toBe(15);
    expect(duracaoUtil(60, { ...avancado, modo: 'rapido' })).toBe(60);
    expect(duracaoUtil(10, { ...avancado, trecho: { inicio: 4, fim: null } })).toBe(6);
  });

  test('estimativa cresce com formatos e duração', () => {
    const um = estimarSegundos([{ tipo: 'video', duracao: 30 }], CONFIG_PADRAO);
    const dois = estimarSegundos([{ tipo: 'video', duracao: 30 }], { ...CONFIG_PADRAO, formatos: ['9x16', '1x1'] });
    expect(dois).toBeGreaterThan(um);
    expect(estimarSegundos([], CONFIG_PADRAO)).toBe(0);
  });

  test('resumo diz exatamente o que será feito', () => {
    expect(resumoDaConfig(CONFIG_PADRAO)).toBe('9:16 (1080×1920) · cortando as bordas · qualidade alta · vídeos sem as pausas (normal)');
    expect(resumoDaConfig({ ...CONFIG_PADRAO, silencios: 'desligado', capa: { ativa: true, titulo: 'Dica' }, logo: { ativa: true } }))
      .toBe('9:16 (1080×1920) · cortando as bordas · qualidade alta · + capa 9:16 com "Dica" · com o seu logo');
    const r = resumoDaConfig({ ...CONFIG_PADRAO, silencios: 'desligado', modo: 'avancado', formatos: ['original'], ajustes: { brilho: 5, contraste: 0, saturacao: -10, nitidez: 0 }, semAudio: true, formatoFoto: 'webp' });
    expect(r).toBe('proporção original · qualidade alta · brilho +5%, saturação -10% · vídeo sem áudio · foto em WEBP');
    expect(filtroCss(CONFIG_PADRAO)).toBe('none');
    expect(resumoDaConfig({ ...CONFIG_PADRAO, modo: 'avancado', realce: true })).toContain('realce de qualidade (upscale)');
    expect(resumoDaConfig({ ...CONFIG_PADRAO, modo: 'rapido', realce: true })).not.toContain('realce');
  });

  test('Shift+clique marca o intervalo nos dois sentidos', () => {
    const ordem = ['a', 'b', 'c', 'd'];
    expect([...selecionarIntervalo(new Set(), ordem, 'd', 'b', true)].sort()).toEqual(['b', 'c', 'd']);
    expect([...selecionarIntervalo(new Set(ordem), ordem, 'a', 'b', false)].sort()).toEqual(['c', 'd']);
  });

  test('validade e tamanho legíveis', () => {
    const agora = Date.parse('2026-01-01T00:00:00Z');
    expect(validadeRestante('2026-01-01T17:30:00Z', agora)).toBe('salva por mais ~17 h');
    expect(validadeRestante('2026-01-01T00:20:00Z', agora)).toBe('salva por mais ~20 min');
    expect(tamanho(5 * 1048576)).toBe('5.0 MB');
  });
});
