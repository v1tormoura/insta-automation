import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config';
import type { Database } from './db/database';
import type { Repositories } from './db/repositories';
import type { MediaTools } from './media/tools';
import type { EventHub } from './services/events';
import type { Storage } from './services/storage';
import { historyToDTO } from './services/dto';
import type { JobQueue } from './queue/jobQueue';

export class HistoryService {
  constructor(
    private repos: Repositories,
    private events: EventHub,
  ) {}

  add(sessionId: string, type: string, level: 'info' | 'success' | 'warning' | 'error', message: string) {
    try {
      const row = this.repos.insertHistory({ session_id: sessionId, type, level, message: message.slice(0, 500), created_at: Date.now() });
      this.events.publish(sessionId, { type: 'history', entry: historyToDTO(row) });
    } catch {
      /* sessão removida no meio da operação: nada a registrar */
    }
  }
}

export interface AppContext {
  config: AppConfig;
  db: Database;
  repos: Repositories;
  log: FastifyBaseLogger;
  tools: MediaTools;
  storage: Storage;
  events: EventHub;
  history: HistoryService;
  queue: JobQueue;
}
