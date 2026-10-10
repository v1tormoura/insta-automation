// Primeiro import: precisa rodar antes de qualquer módulo carregar node:sqlite.
import './silenceSqliteWarning';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const mf = await buildApp(config);
  await mf.start();
  await mf.app.listen({ host: config.host, port: config.port });
  mf.app.log.info(`MediaForge pronto em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    mf.app.log.info({ signal }, 'encerrando: tarefas em execução voltam para a fila');
    const force = setTimeout(() => process.exit(1), 20_000);
    force.unref();
    await mf.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[MediaForge] Falha ao iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
