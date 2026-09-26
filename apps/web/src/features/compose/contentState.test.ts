import type { MediaDTO } from '@nexora/shared';
import { describe, expect, it } from 'vitest';
import { contentProblems, contentReducer, emptyContent, toContentInput } from './contentState';

let n = 0;
const media = (kind: 'image' | 'video', extra: Partial<MediaDTO> = {}): MediaDTO => ({
  id: (++n).toString(16).padStart(24, '0'),
  kind,
  mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  originalName: `${kind}.bin`,
  sizeBytes: 100,
  width: 1080,
  height: 1080,
  durationSeconds: kind === 'video' ? 30 : null,
  previewUrl: '',
  thumbnailUrl: null,
  createdAt: new Date().toISOString(),
  ...extra,
});

describe('contentReducer', () => {
  it('trocar para Reel remove imagens e troca para Foto remove vídeos', () => {
    let s = contentReducer(emptyContent('CAROUSEL'), { type: 'addMedia', media: [media('image'), media('video'), media('image')] });
    expect(s.media).toHaveLength(3);
    const reel = contentReducer(s, { type: 'setType', postType: 'REEL' });
    expect(reel.media.map((m) => m.kind)).toEqual(['video']);
    s = contentReducer(s, { type: 'setType', postType: 'IMAGE' });
    expect(s.media).toHaveLength(1);
    expect(s.media[0]!.kind).toBe('image');
  });

  it('tipo de mídia única substitui em vez de acumular', () => {
    const a = media('image');
    const b = media('image');
    let s = contentReducer(emptyContent('IMAGE'), { type: 'addMedia', media: [a] });
    s = contentReducer(s, { type: 'addMedia', media: [b] });
    expect(s.media.map((m) => m.id)).toEqual([b.id]);
  });

  it('carrossel limita a 10 e reordena', () => {
    const items = Array.from({ length: 12 }, () => media('image'));
    let s = contentReducer(emptyContent('CAROUSEL'), { type: 'addMedia', media: items });
    expect(s.media).toHaveLength(10);
    s = contentReducer(s, { type: 'moveMedia', id: items[0]!.id, delta: 1 });
    expect(s.media[1]!.id).toBe(items[0]!.id);
  });
});

describe('contentProblems / toContentInput', () => {
  it('exige mídia e valida a legenda', () => {
    expect(contentProblems(emptyContent('IMAGE'))[0]).toMatch(/Adicione/);
    const s = contentReducer(contentReducer(emptyContent('IMAGE'), { type: 'addMedia', media: [media('image')] }), {
      type: 'setCaption',
      caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '),
    });
    expect(contentProblems(s)[0]).toMatch(/30 hashtags/);
  });

  it('capa por quadro vira thumbOffsetMs', () => {
    let s = contentReducer(emptyContent('REEL'), { type: 'addMedia', media: [media('video')] });
    s = contentReducer(s, { type: 'setCoverMode', mode: 'frame' });
    s = contentReducer(s, { type: 'setCoverFrame', seconds: 2.5 });
    expect(toContentInput(s).cover).toEqual({ thumbOffsetMs: 2500 });
    expect(contentProblems(s)).toEqual([]);
  });

  it('story não envia legenda', () => {
    let s = contentReducer(emptyContent('STORY'), { type: 'addMedia', media: [media('image')] });
    s = contentReducer(s, { type: 'setCaption', caption: 'oi' });
    expect(toContentInput(s).caption).toBe('');
  });
});
