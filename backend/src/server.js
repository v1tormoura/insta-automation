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

/**
 * Quanto custa uma ida e volta ao banco, no log da subida. É o número que
 * decide a velocidade do painel: cada consulta em sequência paga isto inteiro.
 */
async function medirBanco() {
  const tempos = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    await sql`select 1`;
    tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const ms = Math.round(tempos.sort((a, b) => a - b)[2]);
  console.log(`🗄️  [DB] ida e volta ao banco: ${ms} ms`);
  if (ms > 60) {
    console.log('⚠️  [DB] o banco está longe da VPS — VPS e banco na mesma região (ou o Postgres na própria VPS) deixam cada tela mais rápida');
  }
}

async function subir() {
  await migrar(sql);
  await medirBanco().catch(() => {});

  // Push no celular sem ninguém gerar chave à mão (ver webPush.prepararChaves).
  await require('./services/smartActivity/webPush').prepararChaves()
    .catch(e => console.warn('[WebPush] chaves:', e.message));

  const app = require('./app');
  const servidor = app.listen(config.port, () => console.log(`🚀 API na porta ${config.port} — ${config.publicUrl}`));

  await require('./worker').iniciarWorker();
  require('./services/contas').iniciarSincronizacao();
  require('./services/insightSyncService').startInsightAutoSync();
  require('./services/storyInsightSync').startStoryInsightAutoSync();
  require('./services/vigiaDoSistema').iniciar();
  require('./services/smartActivity/detector').iniciarRelogioDoResumo();
  require('./jobs/limpezaDeArquivos').startLimpezaDeArquivos();
  require('./services/preparoDeMidia').iniciarLimpeza();
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
