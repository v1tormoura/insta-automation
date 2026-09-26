import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { env } from '../../config/env.js';

/**
 * Armazenamento de arquivos. Hoje em disco local (volume no Docker); a
 * interface é a fronteira para trocar por S3/R2 sem tocar no resto — nesse
 * caso `publicUrl` passaria a gerar URL pré-assinada do bucket.
 */
export interface FileStorage {
  putFile(key: string, sourcePath: string, opts?: { move?: boolean }): Promise<void>;
  putBuffer(key: string, data: Buffer): Promise<void>;
  absolutePath(key: string): string;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  removePrefix(prefix: string): Promise<void>;
  read(key: string): NodeJS.ReadableStream;
}

export class LocalStorage implements FileStorage {
  private readonly root: string;

  constructor(root = env.STORAGE_DIR) {
    this.root = resolve(root);
  }

  absolutePath(key: string): string {
    const full = resolve(this.root, key);
    // Nenhuma chave pode escapar da raiz (path traversal).
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new Error('Chave de armazenamento inválida');
    return full;
  }

  async putFile(key: string, sourcePath: string, opts: { move?: boolean } = {}): Promise<void> {
    const dest = this.absolutePath(key);
    await mkdir(dirname(dest), { recursive: true });
    if (opts.move) {
      try {
        await rename(sourcePath, dest);
        return;
      } catch {
        /* dispositivos diferentes: cai para cópia */
      }
    }
    await copyFile(sourcePath, dest);
    if (opts.move) await rm(sourcePath, { force: true });
  }

  async putBuffer(key: string, data: Buffer): Promise<void> {
    const dest = this.absolutePath(key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.absolutePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async size(key: string): Promise<number> {
    return (await stat(this.absolutePath(key))).size;
  }

  async removePrefix(prefix: string): Promise<void> {
    await rm(this.absolutePath(prefix), { recursive: true, force: true });
  }

  read(key: string): NodeJS.ReadableStream {
    return createReadStream(this.absolutePath(key));
  }
}

let storage: FileStorage | undefined;
export function fileStorage(): FileStorage {
  storage ??= new LocalStorage();
  return storage;
}

export const mediaPrefix = (userId: string, mediaId: string) => join('users', userId, 'media', mediaId);
