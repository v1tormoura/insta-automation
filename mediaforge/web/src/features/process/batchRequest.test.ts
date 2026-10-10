import { defaultSettings, type AssetDTO, type ProcessingSettings } from '@mediaforge/shared';
import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatPercent } from '../../lib/format';
import { keptRegion } from '../settings/sections/FramingSection';
import { buildBatchRequest, countOutputs, partsFor } from './batchRequest';

const asset = (over: Partial<AssetDTO>): AssetDTO =>
  ({
    id: 'a1234567',
    kind: 'video',
    name: 'v.mp4',
    ext: 'mp4',
    size: 1,
    sha256: 'x',
    status: 'ready',
    error: null,
    createdAt: 0,
    container: 'MP4',
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    hasAudio: true,
    bitrate: null,
    thumbnailUrl: null,
    fileUrl: '',
    duplicateOf: [],
    metadataSummary: { total: 0, sensitive: 0, byCategory: {} },
    ...over,
  }) as AssetDTO;

const custom = (patch: (s: ProcessingSettings) => void) => {
  const s = defaultSettings('custom');
  patch(s);
  return s;
};

describe('quantidade de saídas (mesma regra do servidor)', () => {
  it('modo rápido nunca divide', () => {
    const s = defaultSettings('quick');
    s.segmentation = { mode: 'count', value: 4 };
    expect(partsFor(asset({}), s)).toBe(1);
  });
  it('divide em N partes ou a cada X segundos, respeitando o corte', () => {
    expect(partsFor(asset({}), custom((s) => (s.segmentation = { mode: 'count', value: 3 })))).toBe(3);
    expect(partsFor(asset({}), custom((s) => (s.segmentation = { mode: 'duration', value: 4 })))).toBe(3);
    expect(
      partsFor(
        asset({}),
        custom((s) => {
          s.segmentation = { mode: 'duration', value: 2 };
          s.trim = { start: 2, end: 6 };
        }),
      ),
    ).toBe(2);
  });
  it('imagens geram uma saída por perfil', () => {
    expect(partsFor(asset({ kind: 'image', durationSec: null }), custom((s) => (s.segmentation = { mode: 'count', value: 5 })))).toBe(1);
  });
  it('total = arquivos × perfis × partes', () => {
    const s = custom((x) => (x.segmentation = { mode: 'count', value: 2 }));
    const r = countOutputs([asset({ id: 'aaaaaaaa' }), asset({ id: 'bbbbbbbb', kind: 'image' })], () => s, ['vertical-9x16', 'feed-4x5']);
    expect(r).toEqual({ files: 2, profiles: 2, total: 2 * 2 + 1 * 2, withParts: true });
  });
});

describe('montagem do lote', () => {
  it('envia configurações individuais só no escopo individual e só dos arquivos selecionados', () => {
    const common = defaultSettings('quick');
    const own = defaultSettings('custom');
    const per = { aaaaaaaa: own, zzzzzzzz: own };
    expect(buildBatchRequest(['aaaaaaaa'], 'common', common, per, []).perAsset).toBeUndefined();
    expect(buildBatchRequest(['aaaaaaaa', 'bbbbbbbb'], 'individual', common, per, []).perAsset).toEqual({ aaaaaaaa: own });
  });
});

describe('visualização do enquadramento', () => {
  it('9:16 recortando 16:9 mantém a altura toda e centraliza pela âncora', () => {
    const g = defaultSettings('custom').geometry;
    g.aspect = '9:16';
    const r = keptRegion(g, 1920, 1080);
    expect(r.h).toBeCloseTo(1);
    expect(r.w).toBeCloseTo((1080 * 9) / 16 / 1920);
    expect(r.x).toBeCloseTo((1 - r.w) / 2);
  });
});

describe('formatação pt-BR', () => {
  it('bytes, duração e porcentagem', () => {
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3.5)).toBe('3,5 s');
    expect(formatPercent(0.426)).toBe('43%');
  });
});
