import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Storage } from '../../src/services/storage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-storage-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Storage.moveNoOverwrite', () => {
  const storage = new Storage(root);
  const dir = (name: string) => {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  it('nome ocupado → sufixo numérico; o arquivo existente fica intacto e a origem some', async () => {
    const out = dir('a');
    fs.writeFileSync(path.join(out, 'video.mp4'), 'anterior');
    const src = path.join(dir('tmp-a'), 'output.mp4');
    fs.writeFileSync(src, 'novo');
    const name = await storage.moveNoOverwrite(src, out, 'video.mp4');
    expect(name).toBe('video-2.mp4');
    expect(fs.readFileSync(path.join(out, 'video.mp4'), 'utf8')).toBe('anterior');
    expect(fs.readFileSync(path.join(out, 'video-2.mp4'), 'utf8')).toBe('novo');
    expect(fs.existsSync(src)).toBe(false);
  });

  it('falha na ORIGEM (ausente) não apaga a saída de outra tarefa com o mesmo nome', async () => {
    const out = dir('b');
    fs.writeFileSync(path.join(out, 'video_tiktok.mp4'), 'saída concluída antes');
    await expect(storage.moveNoOverwrite(path.join(root, 'nao-existe.mp4'), out, 'video_tiktok.mp4')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fs.readFileSync(path.join(out, 'video_tiktok.mp4'), 'utf8')).toBe('saída concluída antes');
    expect(fs.readdirSync(out)).toEqual(['video_tiktok.mp4']);
  });
});
