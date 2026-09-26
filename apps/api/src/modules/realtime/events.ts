import type { RealtimeEvent } from '@nexora/shared';
import type { Redis } from 'ioredis';
import type { Types } from 'mongoose';
import { createRedis, redis } from '../../infra/redis.js';
import { logger } from '../../lib/logger.js';

/**
 * Barramento de eventos em tempo real.
 *
 * Workers e API publicam num canal Redis; cada instância da API assina o canal
 * e repassa para as conexões SSE do usuário dono do evento. Assim o worker não
 * precisa saber quem está conectado nem em qual instância.
 */
const CHANNEL = 'nexora:events';

interface Envelope {
  userId: string;
  event: RealtimeEvent;
}

export async function emit(userId: Types.ObjectId | string, event: RealtimeEvent): Promise<void> {
  try {
    await redis().publish(CHANNEL, JSON.stringify({ userId: String(userId), event } satisfies Envelope));
  } catch (err) {
    // Evento em tempo real é conveniência: falhar aqui não pode derrubar a publicação.
    logger.warn({ err, type: event.type }, 'realtime: falha ao emitir evento');
  }
}

type Listener = (event: RealtimeEvent) => void;

export class RealtimeHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | undefined;

  async start(): Promise<void> {
    this.subscriber = createRedis();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_channel, raw) => {
      let env: Envelope;
      try {
        env = JSON.parse(raw) as Envelope;
      } catch {
        return;
      }
      for (const fn of this.listeners.get(env.userId) ?? []) fn(env.event);
    });
  }

  subscribe(userId: string, fn: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  connectionCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  async stop(): Promise<void> {
    await this.subscriber?.quit();
    this.listeners.clear();
  }
}
