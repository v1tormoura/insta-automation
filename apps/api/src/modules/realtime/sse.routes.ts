import { Router } from 'express';
import { auth, requireAuth } from '../../http/middleware/auth.js';
import type { RealtimeHub } from './events.js';

/** GET /api/events — Server-Sent Events do usuário logado. */
export function sseRoutes(hub: RealtimeHub): Router {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    const { userId } = auth(req);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx: não bufferizar o stream.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    let seq = 0;
    const unsubscribe = hub.subscribe(userId.toString(), (event) => {
      res.write(`id: ${++seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    // Comentário periódico mantém proxies e balanceadores com a conexão aberta.
    const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
