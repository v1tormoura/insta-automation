import { pino, stdSerializers } from 'pino';
import { env } from '../config/env.js';
import { REDACT_PATHS, redactText } from './redact.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? (process.env.TEST_LOG_LEVEL ?? 'silent') : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: process.env.NEXORA_PROCESS ?? 'api' },
  formatters: { level: (label) => ({ level: label }) },
  // Mensagens de erro podem carregar a URL chamada; a URL pode carregar o token.
  hooks: {
    logMethod(args, method) {
      method.apply(
        this,
        args.map((a) => (typeof a === 'string' ? redactText(a) : a)) as Parameters<typeof method>,
      );
    },
  },
  serializers: {
    err: (err: unknown) => {
      const e = stdSerializers.err(err as Error);
      if (e?.message) e.message = redactText(e.message);
      if (e?.stack) e.stack = redactText(e.stack);
      return e;
    },
  },
});

export type Logger = typeof logger;
