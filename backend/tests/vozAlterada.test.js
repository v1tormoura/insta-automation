'use strict';

/**
 * Voz alterada (experimental) — pitch e velocidade da fala original.
 *
 * O que estes testes protegem: a matemática. Pitch via `asetrate` muda a
 * duração junto, e `atempo` tem que compensar EXATAMENTE para o áudio terminar
 * onde o vídeo (com `setpts`) termina. Errar aqui não quebra o render — entrega
 * fala descolada da imagem, que é pior, porque parece que funcionou.
 *
 * O que eles NÃO provam: que isso engana o casamento por áudio do Instagram.
 * Ninguém fora do Meta sabe o limiar. É um preset para testar em poucos vídeos
 * e medir alcance; o teste automatizado só garante que o vídeo sai íntegro.
 */

const {
  buildFilterComplex, buildVoz, VOZ_PITCH_MAX, VOZ_VEL_MIN, VOZ_VEL_MAX,
} = require('../src/services/renderEngine/filterBuilder');

const path = require('path');
const ARQUIVO_QUE_EXISTE = __filename;

function montar(voz, audio = { keepOriginal: true }) {
  return buildFilterComplex(
    { canvas: { width: 1080, height: 1920 }, elements: [{ type: 'video', fit: 'cover' }], audio, voz },
    { VIDEO: '/app/uploads/entrada.mp4' },
  );
}

/** Extrai `chave=valor` numérico de dentro de um filtro. */
const valor = (cadeia, chave) => {
  const m = cadeia.match(new RegExp(`${chave}=([\\d.]+)`));
  return m ? Number(m[1]) : null;
};

describe('buildVoz — a matemática do pitch e da velocidade', () => {
  test('desligado não produz filtro nenhum', () => {
    expect(buildVoz({ enabled: false, pitch: -6, velocidade: 7 }).ativo).toBe(false);
    expect(buildVoz(undefined).ativo).toBe(false);
    expect(buildVoz({ enabled: true, pitch: 0, velocidade: 0 }).ativo).toBe(false);
  });

  test('o preset experimental: pitch −6 %, velocidade +7 %', () => {
    const v = buildVoz({ enabled: true, pitch: -6, velocidade: 7 });
    expect(v.ativo).toBe(true);
    expect(v.p).toBeCloseTo(0.94, 6);
    expect(v.t).toBeCloseTo(1.07, 6);
    // asetrate = 44100 × 0,94
    expect(valor(v.filtroAudio, 'asetrate')).toBe(Math.round(44100 * 0.94));
    // atempo = t / p — o que sobra depois do asetrate para a duração bater
    expect(valor(v.filtroAudio, 'atempo')).toBeCloseTo(1.07 / 0.94, 3);
    expect(v.filtroVideo).toBe('setpts=PTS/1.0700');
  });

  test('a duração final do áudio e do vídeo coincidem', () => {
    /* asetrate deixa duração × 1/p; atempo divide por k. Para bater com o
       vídeo (× 1/t) precisa: (1/p)·(1/k) = 1/t  ⇒  k = t/p. */
    for (const [pitch, vel] of [[-6, 7], [10, -10], [-20, 30], [5, 0], [0, 12]]) {
      const v = buildVoz({ enabled: true, pitch, velocidade: vel });
      const k = valor(v.filtroAudio, 'atempo') ?? 1;
      const duracaoAudio = (1 / v.p) * (1 / k);
      const duracaoVideo = 1 / v.t;
      expect(duracaoAudio).toBeCloseTo(duracaoVideo, 3);
    }
  });

  test('pitch sozinho não mexe no vídeo', () => {
    const v = buildVoz({ enabled: true, pitch: -8, velocidade: 0 });
    expect(v.filtroVideo).toBe('');
    // mas compensa a duração que o asetrate mudou
    expect(valor(v.filtroAudio, 'atempo')).toBeCloseTo(1 / 0.92, 3);
  });

  test('normaliza a taxa ANTES do asetrate', () => {
    /* Sem isto, entrada de 48 kHz deslocaria o pitch na proporção errada. */
    const v = buildVoz({ enabled: true, pitch: -6, velocidade: 0 });
    expect(v.filtroAudio.startsWith('aresample=44100,asetrate=')).toBe(true);
  });

  test('valores fora da faixa são presos, não obedecidos', () => {
    const v = buildVoz({ enabled: true, pitch: -90, velocidade: 300 });
    expect(v.p).toBeCloseTo(1 - VOZ_PITCH_MAX / 100, 6);
    expect(v.t).toBeCloseTo(1 + VOZ_VEL_MAX / 100, 6);
    expect(buildVoz({ enabled: true, velocidade: -99 }).t).toBeCloseTo(1 + VOZ_VEL_MIN / 100, 6);
  });

  test('atempo fica na faixa que o ffmpeg aceita nos extremos', () => {
    for (const [pitch, vel] of [[-20, 30], [20, -20], [-20, -20], [20, 30]]) {
      const k = valor(buildVoz({ enabled: true, pitch, velocidade: vel }).filtroAudio, 'atempo') ?? 1;
      expect(k).toBeGreaterThanOrEqual(0.5);
      expect(k).toBeLessThanOrEqual(2);
    }
  });
});

describe('a voz dentro do grafo completo', () => {
  test('sem trilha: o áudio mapeado é a voz tratada', () => {
    const r = montar({ enabled: true, pitch: -6, velocidade: 7 });
    expect(r.audioMap).toBe('[a_voz]');
    expect(r.filterComplex).toContain('[0:a]aresample=44100,asetrate=41454,aresample=44100,atempo=1.1383[a_voz]');
    expect(r.filterComplex).toContain('setpts=PTS/1.0700[vel]');
    expect(r.videoMap).toBe('[vel]');
  });

  test('misturando com trilha: a voz tratada é que entra no amix, não o [0:a] cru', () => {
    const r = montar({ enabled: true, pitch: -6, velocidade: 7 }, { keepOriginal: true, musicTrack: ARQUIVO_QUE_EXISTE, musicVolume: 0.12 });
    expect(r.filterComplex).toContain('[a_voz]volume=1[ao0]');
    expect(r.filterComplex).not.toContain('[0:a]volume=');
    expect(r.audioMap).toBe('[a_out]');
  });

  test('substituindo o áudio, a voz não se aplica (não há original) — mas o vídeo ainda acelera', () => {
    const r = montar({ enabled: true, pitch: -6, velocidade: 7 }, { keepOriginal: false, musicTrack: ARQUIVO_QUE_EXISTE });
    expect(r.filterComplex).not.toContain('a_voz');
    expect(r.filterComplex).toContain('setpts=PTS/1.0700');
  });

  test('desligado, o grafo é o de sempre', () => {
    const r = montar({ enabled: false, pitch: -6, velocidade: 7 });
    expect(r.audioMap).toBe('0:a?');
    expect(r.filterComplex).not.toContain('setpts');
    expect(r.filterComplex).not.toContain('asetrate');
  });

  test('a velocidade vem DEPOIS do texto e da borda', () => {
    /* Regra simples: acelera o vídeo inteiro pronto. Se viesse antes, cada
       elemento com tempo (gancho até 3s) teria que ser reescalado. */
    const r = buildFilterComplex(
      {
        canvas: { width: 1080, height: 1920 },
        elements: [{ type: 'video', fit: 'cover' }],
        border: { enabled: true, thickness: 4 },
        voz: { enabled: true, velocidade: 7 },
        audio: { keepOriginal: true },
      },
      { VIDEO: '/x.mp4' },
    );
    const filtros = r.filterComplex.split(';');
    const iBorda = filtros.findIndex(f => f.includes('drawbox'));
    const iVel   = filtros.findIndex(f => f.includes('setpts'));
    expect(iBorda).toBeGreaterThanOrEqual(0);
    expect(iVel).toBeGreaterThan(iBorda);
  });
});
