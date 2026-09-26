import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Variáveis mínimas para o `env` validar. Cada arquivo de teste recebe um
// banco Redis e um diretório de storage próprios.
process.env.NODE_ENV = 'test';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.MEDIA_SIGNING_SECRET ??= 'test-media-signing-secret-with-32-chars!!';
process.env.INSTAGRAM_APP_ID ??= 'test-app-id';
process.env.INSTAGRAM_APP_SECRET ??= 'test-app-secret';
process.env.APP_URL ??= 'http://localhost:5173';
process.env.API_PUBLIC_URL ??= 'https://api.test.local';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'nexora-test-storage-'));
process.env.FFPROBE_PATH ??= '/nonexistent/ffprobe';
process.env.FFMPEG_PATH ??= '/nonexistent/ffmpeg';
