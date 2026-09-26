import { describe, expect, it } from 'vitest';
import { analyzeCaption } from './caption.js';
import { createPostSchema, postContentSchema } from './schemas.js';

const id = (n: number) => n.toString(16).padStart(24, '0');

describe('analyzeCaption', () => {
  it('conta hashtags, menções e code points', () => {
    const r = analyzeCaption('Olá 👋 #praia #sol @maria e email a@b.com');
    expect(r.hashtags).toBe(2);
    expect(r.mentions).toBe(1);
    expect(r.length).toBe([...'Olá 👋 #praia #sol @maria e email a@b.com'].length);
    expect(r.problems).toEqual([]);
  });

  it('aponta excesso de hashtags', () => {
    const caption = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
    expect(analyzeCaption(caption).problems[0]).toMatch(/30 hashtags/);
  });
});

describe('postContentSchema', () => {
  it('carrossel exige de 2 a 10 mídias', () => {
    const r = postContentSchema.safeParse({ type: 'CAROUSEL', caption: '', mediaIds: [id(1)] });
    expect(r.success).toBe(false);
  });

  it('capa só é aceita em Reels', () => {
    const r = postContentSchema.safeParse({ type: 'IMAGE', mediaIds: [id(1)], cover: { thumbOffsetMs: 1000 } });
    expect(r.success).toBe(false);
    const ok = postContentSchema.safeParse({ type: 'REEL', mediaIds: [id(1)], cover: { thumbOffsetMs: 1000 } });
    expect(ok.success).toBe(true);
  });

  it('rejeita capa com imagem e quadro ao mesmo tempo', () => {
    const r = postContentSchema.safeParse({ type: 'REEL', mediaIds: [id(1)], cover: { mediaId: id(2), thumbOffsetMs: 0 } });
    expect(r.success).toBe(false);
  });
});

describe('createPostSchema', () => {
  it('rejeita contas duplicadas', () => {
    const r = createPostSchema.safeParse({
      content: { type: 'IMAGE', mediaIds: [id(1)] },
      accountIds: [id(9), id(9)],
      schedule: { mode: 'now' },
    });
    expect(r.success).toBe(false);
  });

  it('aceita agendamento com data ISO', () => {
    const r = createPostSchema.safeParse({
      content: { type: 'IMAGE', mediaIds: [id(1)], caption: 'oi' },
      accountIds: [id(9)],
      schedule: { mode: 'scheduled', at: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(r.success).toBe(true);
  });
});
