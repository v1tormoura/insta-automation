'use strict';

/**
 * Fila de trabalhos no próprio Postgres.
 *
 * Substitui BullMQ + Redis: um serviço a menos para subir, pagar e vigiar. O
 * volume aqui é de dezenas de trabalhos por hora, e `FOR UPDATE SKIP LOCKED` é
 * o mecanismo padrão do Postgres para exatamente isto.
 *
 *   enfileirar(nome, dados, { atrasoMs, chave })
 *     `chave` torna o enfileiramento idempotente: a segunda chamada com a mesma
 *     chave não cria outro trabalho. Serve de id estável para cancelar.
 *   cancelar(chave)   — tira da fila o que ainda não começou.
 *   iniciar(handlers) — processa em segundo plano, até `concorrencia` por vez.
 *
 * Trabalho concluído (ou que falhou) sai da tabela: o histórico que importa já
 * está em posts, jobs e campanhas. Na subida, o que ficou em 'running' é órfão
 * de um processo que morreu, e volta para a fila.
 */

const { sql } = require('../db');

const INTERVALO_MS = 1000;

async function enfileirar(nome, dados = {}, { atrasoMs = 0, chave = null } = {}) {
  const runAt = new Date(Date.now() + Math.max(0, Number(atrasoMs) || 0));
  const [row] = await sql`
    insert into queue_jobs (name, data, key, run_at)
    values (${nome}, ${sql.json(dados)}, ${chave}, ${runAt})
    on conflict (key) do nothing
    returning id`;
  if (row) return row.id;
  const [existente] = await sql`select id from queue_jobs where key = ${chave}`;
  return existente ? existente.id : null;
}

/** Remove da fila pelo `chave` ou pelo id. Não interrompe o que já está rodando. */
async function cancelar(chaveOuId) {
  if (!chaveOuId) return 0;
  const r = await sql`
    delete from queue_jobs
    where status = 'queued' and (key = ${String(chaveOuId)} or id::text = ${String(chaveOuId)})`;
  return r.count;
}

/** Remove da fila os trabalhos `nome` ainda não iniciados cujo `dados[campo]` é `valor`. */
async function cancelarPorDados(nome, campo, valor) {
  const r = await sql`
    delete from queue_jobs
    where status = 'queued' and name = ${nome} and data->>${campo} = ${String(valor)}`;
  return r.count;
}

async function existe(chave) {
  const [row] = await sql`select 1 from queue_jobs where key = ${chave}`;
  return !!row;
}

async function reservar(quantos) {
  return sql`
    update queue_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from queue_jobs
      where status = 'queued' and run_at <= now()
      order by run_at
      limit ${quantos}
      for update skip locked
    )
    returning *`;
}

let _rodando = false;
let _ativos = 0;
let _timer = null;

/**
 * @param {Record<string, (dados: object) => Promise<void>>} handlers
 * @param {{concorrencia?: number}} [opts]
 */
async function iniciar(handlers, { concorrencia = 5 } = {}) {
  if (_rodando) return;
  _rodando = true;

  const orfaos = await sql`update queue_jobs set status = 'queued', locked_at = null where status = 'running'`;
  if (orfaos.count) console.log(`♻️  [Fila] ${orfaos.count} trabalho(s) interrompido(s) voltaram para a fila`);

  const executar = async job => {
    const handler = handlers[job.name];
    try {
      if (!handler) console.warn(`[Fila] trabalho sem handler: ${job.name}`);
      else await handler(job.data || {});
    } catch (err) {
      console.error(`[Fila] "${job.name}" falhou: ${err?.message || err}`);
    } finally {
      await sql`delete from queue_jobs where id = ${job.id}`.catch(() => {});
      _ativos--;
    }
  };

  const ciclo = async () => {
    if (!_rodando) return;
    try {
      const livres = concorrencia - _ativos;
      if (livres > 0) {
        const jobs = await reservar(livres);
        for (const job of jobs) {
          _ativos++;
          executar(job);
        }
      }
    } catch (err) {
      console.error('[Fila] leitura falhou:', err.message);
    }
    _timer = setTimeout(ciclo, INTERVALO_MS);
  };
  ciclo();
  console.log(`[Fila] processando (até ${concorrencia} trabalhos ao mesmo tempo)`);
}

function parar() {
  _rodando = false;
  if (_timer) clearTimeout(_timer);
}

module.exports = { enfileirar, cancelar, cancelarPorDados, existe, iniciar, parar };
