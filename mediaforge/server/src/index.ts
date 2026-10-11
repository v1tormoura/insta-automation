// Primeiro import: precisa rodar antes de qualquer módulo carregar node:sqlite.
import './silenceSqliteWarning';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const mf = await buildApp(config);
  await mf.detectTools();
  try {
    // Primeiro a porta: se estiver ocupada, nada é limpo nem reivindicado.
    await mf.app.listen({ host: config.host, port: config.port });
  } catch (err) {
    await mf.stop().catch(() => undefined);
    throw (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? new Error(`A porta ${config.port} já está em uso (outra instância do MediaForge ou outro programa). Ajuste PORT no .env.`)
      : err;
  }
  await mf.start();
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
  // Terminal fechado (Linux/macOS) e Ctrl+Break / janela do console fechada (Windows).
  process.on('SIGHUP', () => void shutdown('SIGHUP'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
}

main().catch((err) => {
  console.error('[MediaForge] Falha ao iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
