'use strict';

/**
 * Sobe tudo num processo só: migra o banco, abre a API, liga a fila de
 * publicação e os ciclos periódicos (sincronização de contas, métricas,
 * stories, vigia, limpeza, reset diário, resumo do dia).
 */

const config = require('./config');
config.validar();

const { sql } = require('./db');
const { migrar } = require('./db/migrate');

async function subir() {
  await migrar(sql);

  const app = require('./app');
  const servidor = app.listen(config.port, () => console.log(`🚀 API na porta ${config.port} — ${config.publicUrl}`));

  await require('./worker').iniciarWorker();
  require('./services/contas').iniciarSincronizacao();
  require('./services/insightSyncService').startInsightAutoSync();
  require('./services/storyInsightSync').startStoryInsightAutoSync();
  require('./services/vigiaDoSistema').iniciar();
  require('./services/smartActivity/detector').iniciarRelogioDoResumo();
  require('./jobs/limpezaDeArquivos').startLimpezaDeArquivos();
  require('./jobs/resetDailyPosts')();

  const encerrar = sinal => {
    console.log(`${sinal} recebido — encerrando`);
    require('./queue').parar();
    servidor.close(() => sql.end({ timeout: 5 }).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

subir().catch(err => {
  console.error('💥 Falha ao subir:', err);
  process.exit(1);
});
