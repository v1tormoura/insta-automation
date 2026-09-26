'use strict';

/**
 * O motor de publicação: os trabalhos da fila e o caminho único para publicar
 * numa conta.
 *
 *   job_round ............ uma rodada de um envio (Postar e Loop)
 *   post ................. reprocessar um post avulso (botão "tentar de novo")
 *   comentario_fixado .... o comentário 2 min depois da publicação
 *   campanha_publicacao .. uma publicação de campanha
 *   campanha_comentario .. o comentário de uma publicação de campanha
 *
 * Toda publicação passa por `publicarNaConta`: trava a conta (uma publicação
 * por vez), respeita ritmo e cota da API, grava o resultado e decide a saúde
 * da conta a partir do erro.
 */

const { sql } = require('./db');
const { accounts, jobs, posts } = require('./repos');
const fila = require('./queue');
const { broadcast } = require('./events/broadcaster');
const { publicar } = require('./services/publicar');
const graph = require('./services/instagramAPI');
const contas = require('./services/contas');
const cotaDaApi = require('./services/cotaDaApi');
const { podePublicar } = require('./services/ritmoDaConta');
const { criarRandom, embaralhar, espacarPorConta } = require('./services/publicationPlanner');
const { comJitter } = require('./services/ritmoHumano');
const traduzirErro = require('./utils/traduzirErro');
const avisos = require('./services/smartActivity/eventosDePublicacao');

const delay = ms => new Promise(r => setTimeout(r, ms));
const ESPERA_DA_TRAVA_MS = 5 * 60 * 1000;
const PISO_INTERVALO_MS = 60_000;
const TETO_ESPERA_MS = 6 * 60 * 60 * 1000;
const ESTADOS_ATIVOS = ['queued', 'running', 'waiting_interval'];

/** Intervalo humano entre publicações seguidas de uma rodada. */
const intervaloHumano = () => 120_000 + Math.floor(Math.random() * 180_000);

function mesmoDia(data) {
  if (!data) return false;
  const d = new Date(data), hoje = new Date();
  return d.toDateString() === hoje.toDateString();
}

/**
 * Ritmo (teto/janela, escolha de quem opera) e cota da API (regra da Meta)
 * num veredito só: `{ pode, motivo, ate, cotaCheia? }`.
 */
async function podePublicarAgora(conta, agora = new Date()) {
  const paraRitmo = mesmoDia(conta.lastPostDate) ? conta : { ...conta, postsToday: 0 };
  const ritmo = podePublicar(paraRitmo, agora);
  if (!ritmo.pode) return ritmo;
  const cota = await cotaDaApi.consultar(conta);
  if (!cota?.cheia) return ritmo;
  const ate = await cotaDaApi.proximaLiberacao(conta, agora);
  return { pode: false, motivo: cotaDaApi.motivo(cota, ate), ate, cotaCheia: true };
}

function erroComCodigo(mensagem, code, extra = {}) {
  return Object.assign(new Error(mensagem), { code }, extra);
}

/** Uma conta por vez: espera até 5 min pela trava antes de desistir. */
async function travarConta(id, username) {
  const inicio = Date.now();
  for (;;) {
    const conta = await accounts.travar(id);
    if (conta) return conta;
    if (Date.now() - inicio > ESPERA_DA_TRAVA_MS) throw erroComCodigo('conta em uso — tempo de espera esgotado (5min)', 'ACCOUNT_BUSY');
    console.log(`[Publicar] @${username} em uso por outra publicação, aguardando…`);
    await delay(5000);
  }
}

/** Agenda o comentário fixado desta publicação. Nunca lança. */
async function agendarComentarioFixado(conta, post, mediaId) {
  try {
    const { decidirComentario, ATRASO_MS } = require('./services/comentarioDoPost');
    const decisao = decidirComentario({ modelo: post.ctaComment, account: conta, mediaId });
    if (!decisao.comentar) {
      if (decisao.motivo !== 'sem_texto') console.log(`[Comentário] @${conta.username}: não enviado (${decisao.motivo})`);
      return;
    }
    await fila.enfileirar('comentario_fixado', { accountId: conta.id, mediaId, texto: decisao.texto }, { atrasoMs: ATRASO_MS });
  } catch (err) {
    console.log(`⚠️ [Comentário] não deu para agendar: ${err.message}`);
  }
}

/**
 * Publica `post` na conta. Lança em falha — com `code: 'RHYTHM_WAIT'` e
 * `retryAt` quando é só "agora não" (ritmo ou cota), para quem chama reagendar.
 * @returns {Promise<{ok: true, mediaId: string}>}
 */
async function publicarNaConta(contaAlvo, post, { respeitarRitmo = true } = {}) {
  const atual = await accounts.findById(contaAlvo.id);
  if (!atual) throw erroComCodigo('Conta não encontrada', 'ACCOUNT_UNAVAILABLE');
  if (atual.healthStatus === 'banida') throw erroComCodigo(`Conta @${atual.username} está banida — publicação cancelada`, 'ACCOUNT_UNAVAILABLE');

  let conta = await travarConta(atual.id, atual.username);
  broadcast('accounts', { action: 'busy', accountId: conta.id }, conta.usuarioId);

  if (!mesmoDia(conta.lastPostDate)) {
    conta = await accounts.update(conta.id, { postsToday: 0, lastPostDate: new Date() });
  }
  // Story manual (tela de Stories) sai na hora: quem clicou está esperando.
  const ritmo = respeitarRitmo ? await podePublicarAgora(conta) : { pode: true };
  if (!ritmo.pode) {
    await accounts.destravar(conta.id);
    throw erroComCodigo(ritmo.motivo || 'Aguardando janela de publicação', 'RHYTHM_WAIT', { retryAt: ritmo.ate });
  }

  const tipo = post.postType || 'reel';
  try {
    const postDaConta = tipo === 'story' ? post : require('./services/capaPorConta').aplicar(post, conta);
    console.log(`[Publicar] @${conta.username} — ${tipo} ${post.media}`);
    const { mediaId } = await publicar(conta, postDaConta);

    await accounts.update(conta.id, {
      postsToday: (conta.postsToday || 0) + 1, lastPostDate: new Date(), lastPostAt: new Date(),
      healthStatus: 'ativa', lastError: '', isBusy: false, busySince: null, busyReason: '',
    });
    if (mediaId && post.id) {
      await sql`
        update posts set ig_media_id = ${mediaId},
          midias_publicadas = midias_publicadas || ${sql.json([{ accountId: conta.id, igMediaId: mediaId, em: new Date().toISOString() }])}
        where id = ${post.id}`;
    }
    console.log(`✅ [Publicar] @${conta.username} — publicado (${mediaId})`);
    broadcast('accounts', { action: 'synced' }, conta.usuarioId);
    avisos.notificarPublicado({ conta, contentType: tipo }).catch(e => console.log('[Aviso]', e.message));
    await agendarComentarioFixado(conta, post, mediaId);
    return { ok: true, mediaId };
  } catch (err) {
    console.log(`❌ [Publicar] @${conta.username}: ${err.message}`);
    const update = { isBusy: false, busySince: null, busyReason: '' };

    if (cotaDaApi.ehErroDeCota(err)) {
      cotaDaApi.marcarCheia(conta);
      await accounts.update(conta.id, update);
      const ate = await cotaDaApi.proximaLiberacao(conta);
      throw erroComCodigo(`@${conta.username}: ${cotaDaApi.motivo({ usage: cotaDaApi.LIMITE, limite: cotaDaApi.LIMITE }, ate)}`, 'RHYTHM_WAIT', { retryAt: ate });
    }

    // Só muda a saúde quando o Instagram disse algo sobre a CONTA.
    const c = contas.classificarErro(err);
    update.lastError = c?.mensagem || traduzirErro(err.message);
    if (c) update.healthStatus = c.status;
    if (c?.status === 'banida') {
      update.status = 'banida';
      contas.cancelarTrabalho(conta.id, `Conta @${conta.username} suspensa pelo Instagram`).catch(() => {});
    }
    await accounts.update(conta.id, update);
    broadcast('accounts', { action: 'health_update', accountId: conta.id, username: conta.username, healthStatus: update.healthStatus || conta.healthStatus }, conta.usuarioId);
    avisos.notificarErro({ conta, contentType: tipo, erro: update.lastError }).catch(e => console.log('[Aviso]', e.message));
    throw err;
  }
}

// ── Envios (Postar e Loop) ───────────────────────────────────────────────────

async function agendarRodada(jobId, atrasoMs = 0) {
  await fila.cancelarPorDados('job_round', 'jobId', jobId);
  await fila.enfileirar('job_round', { jobId }, { atrasoMs });
}

/** O post desta mídia nesta rodada — o mesmo, se a rodada rodar de novo. */
async function postDaRodada(job, media, rodada, legenda) {
  const video = /\.(mp4|mov|webm|avi|mkv)$/i.test(media);
  let postType = job.postType || 'reel';
  if (postType === 'reel' && !video) postType = 'post';
  const [novo] = await sql`
    insert into posts ${sql({
      media, jobId: job.id, jobRound: rodada, jobCiclo: job.ciclo || 0, jobName: job.name || '', usuarioId: job.usuarioId,
      mediaType: video ? 'video' : 'image', postType,
      cover: job.cover || '', caption: legenda ?? (job.caption || ''), ctaComment: job.ctaComment || '',
      processMode: job.processMode || 'sem_limpeza',
      marcaDagua: job.marcaDagua?.ativa ? job.marcaDagua : null,
      variacaoEdicao: job.variacaoEdicao?.ativa ? job.variacaoEdicao : null,
      trilha: job.trilha?.modo && job.trilha.modo !== 'nenhuma' && job.trilha.ids?.length ? job.trilha : null,
      capasPorConta: job.capasPorConta?.length ? job.capasPorConta : null,
      accountIds: job.accountIds, status: 'processando', scheduledAt: new Date(),
    })}
    on conflict (job_id, job_ciclo, media, job_round) where job_id is not null do nothing
    returning *`;
  if (novo) return novo;
  const [existente] = await sql`
    select * from posts where job_id = ${job.id} and job_ciclo = ${job.ciclo || 0} and media = ${media} and job_round = ${rodada}`;
  return existente;
}

async function processarRodada({ jobId }) {
  const job = await jobs.findById(jobId);
  if (!job || ['cancelled', 'completed', 'paused'].includes(job.status)) return;

  const total = job.mediaFiles.length;
  let rodada = job.currentRound;
  if (rodada * job.simultaneousLimit >= total) {
    if (job.type !== 'loop') {
      await jobs.update(job.id, { status: 'completed', completedAt: new Date() });
      broadcast('jobs', { action: 'job_updated', jobId: job.id }, job.usuarioId);
      return;
    }
    rodada = 0;
    const [{ ciclo }] = await sql`
      update jobs set current_round = 0, rounds_completed = 0, ciclo = ciclo + 1 where id = ${job.id} returning ciclo`;
    job.ciclo = ciclo;
    broadcast('posts', { action: 'loop_cycled', jobId: job.id }, job.usuarioId);
  }

  const [ativado] = await sql`
    update jobs set status = 'running', started_at = coalesce(started_at, now())
    where id = ${job.id} and status not in ('paused', 'cancelled', 'completed')
    returning *`;
  if (!ativado) return;
  broadcast('jobs', { action: 'job_updated', jobId: job.id }, job.usuarioId);

  // Só contas do dono do envio — o painel já garante, e o worker confere de novo.
  const contasDoJob = (await accounts.porIds(job.accountIds)).filter(c => c.status !== 'banida' && c.usuarioId === job.usuarioId);
  const { midiasDaRodada } = require('./services/rodizioDeMidias');
  const plano = midiasDaRodada({
    midias: job.mediaFiles, contas: contasDoJob, rodada, porRodada: job.simultaneousLimit, rodizio: !!job.rodizioDeMidias,
  });
  const rand = criarRandom(`${job.id}:${rodada}`);
  const contasDaRodada = embaralhar(contasDoJob, rand);

  // Quem pode publicar agora (ritmo e cota) — decidido ANTES de criar posts.
  const vereditos = await Promise.all(contasDaRodada.map(async conta => ({ conta, ritmo: await podePublicarAgora(conta) })));
  for (const v of vereditos) {
    if (v.ritmo.cotaCheia) avisos.notificarCotaDaApi({ conta: v.conta, motivo: v.ritmo.motivo, ate: v.ritmo.ate }).catch(() => {});
  }
  const disponiveis = vereditos.filter(v => v.ritmo.pode).map(v => v.conta);

  // ±12% sobre o intervalo pedido: múltiplos exatos seriam uma cadência que ninguém produz.
  const intervaloDoJob = () => comJitter((job.intervalMinutes || 0) * 60_000, { pisoMs: PISO_INTERVALO_MS });

  if (contasDaRodada.length && !disponiveis.length) {
    const aberturas = vereditos.map(v => v.ritmo.ate).filter(Boolean).map(d => new Date(d).getTime());
    const ateLiberar = aberturas.length ? Math.min(...aberturas) - Date.now() : 0;
    const espera = Math.min(TETO_ESPERA_MS, Math.max(intervaloDoJob(), ateLiberar));
    console.log(`[Envio] "${job.name}" — nenhuma conta disponível agora: ${vereditos.map(v => `${v.conta.username}: ${v.ritmo.motivo}`).join(' | ')}`);
    await jobs.update(job.id, { status: 'waiting_interval', nextRoundAt: new Date(Date.now() + espera) });
    await agendarRodada(job.id, espera);
    broadcast('jobs', { action: 'job_updated', jobId: job.id }, job.usuarioId);
    return;
  }

  const sorteio = await require('./services/legendaAleatoria').sortearParaRodada(job, plano.distintas.length)
    .catch(e => { console.log(`[Envio] sorteio de legenda falhou: ${e.message}`); return null; });

  const preparadas = [];
  for (const [i, media] of plano.distintas.entries()) {
    try {
      const post = await postDaRodada(job, media, rodada, sorteio?.legendas?.[i]?.texto);
      preparadas.push({ media, post, sucessos: 0, erros: [] });
    } catch (err) {
      console.log(`⚠️ [Envio] "${job.name}" — preparo de ${media} falhou: ${err.message}`);
    }
  }

  // Rodada repetida (restart no meio): quem já recebeu não recebe de novo.
  const jaPublicado = new Set(preparadas.flatMap(p => (p.post.midiasPublicadas || []).map(m => `${p.post.id}:${m.accountId}`)));
  const porMidia = new Map(preparadas.map(p => [p.media, p]));
  const pares = [];
  for (const conta of disponiveis) {
    for (const nome of plano.porConta.get(String(conta.id)) || []) {
      const p = porMidia.get(nome);
      if (p && !jaPublicado.has(`${p.post.id}:${conta.id}`)) pares.push({ accountId: conta.id, conta, preparada: p });
    }
  }
  const sequencia = espacarPorConta(embaralhar(pares, rand));

  let sucessos = 0, erros = 0;
  for (const [i, { conta, preparada }] of sequencia.entries()) {
    if (i > 0) await delay(intervaloHumano());
    // Sinal de vida + leitura do status: pausar/cancelar vale no meio da rodada.
    const [{ status } = {}] = await sql`update jobs set updated_at = now() where id = ${job.id} returning status`;
    if (['paused', 'cancelled'].includes(status)) break;
    try {
      await publicarNaConta(conta, preparada.post);
      preparada.sucessos++; sucessos++;
    } catch (err) {
      preparada.erros.push(`@${conta.username}: ${err.message}`); erros++;
    }
  }

  for (const p of preparadas) {
    const feitas = p.sucessos + p.erros.length;
    const status = feitas === 0 || p.sucessos === 0 ? 'erro' : p.sucessos === feitas ? 'concluido' : 'parcial';
    await posts.update(p.post.id, { status, error: p.erros.join(' | ') });
  }

  const proxima = rodada + 1;
  const temMais = proxima * job.simultaneousLimit < total || job.type === 'loop';
  await sql`
    update jobs set posts_published = posts_published + ${sucessos}, posts_errors = posts_errors + ${erros},
      rounds_completed = rounds_completed + 1, current_round = ${proxima}
    where id = ${job.id}`;
  broadcast('posts', { action: 'created' }, job.usuarioId);

  if (!temMais) {
    await jobs.update(job.id, { status: 'completed', completedAt: new Date() });
    broadcast('jobs', { action: 'job_updated', jobId: job.id }, job.usuarioId);
    return;
  }

  const atual = await jobs.findById(job.id);
  if (!atual || ['paused', 'cancelled'].includes(atual.status)) return;

  const espera = intervaloDoJob();
  const cicloDoLoop = job.type === 'loop' && proxima * job.simultaneousLimit >= total;
  await jobs.update(job.id, {
    status: 'waiting_interval', nextRoundAt: new Date(Date.now() + espera),
    ...(cicloDoLoop ? { currentRound: 0, roundsCompleted: 0 } : {}),
  });
  // Nova volta, posts novos: sem isto a volta seguinte acharia os desta.
  if (cicloDoLoop) await sql`update jobs set ciclo = ciclo + 1 where id = ${job.id}`;
  await agendarRodada(job.id, espera);
  broadcast('jobs', { action: 'job_updated', jobId: job.id }, job.usuarioId);
  console.log(`[Envio] "${job.name}" — rodada ${rodada + 1} (✓${sucessos} ✗${erros}). Próxima em ${(espera / 60000).toFixed(1)} min`);
}

/** Reprocessa um post avulso nas contas dele, uma de cada vez. */
async function processarPost({ postId }) {
  const post = await posts.findById(postId);
  if (!post) return;
  await posts.update(post.id, { status: 'processando', error: '' });

  // Retentar um post parcial não pode publicar de novo onde ele já saiu.
  const jaSaiu = new Set((post.midiasPublicadas || []).map(m => m.accountId));
  const pendentes = (await accounts.porIds(post.accountIds)).filter(c => !jaSaiu.has(c.id) && c.usuarioId === post.usuarioId);
  const lista = embaralhar(pendentes, criarRandom(`post:${post.id}`));
  let ok = jaSaiu.size;
  const erros = [];
  for (const [i, conta] of lista.entries()) {
    if (i > 0) await delay(intervaloHumano());
    try { await publicarNaConta(conta, post); ok++; }
    catch (err) { erros.push(`@${conta.username}: ${err.message}`); }
  }
  const status = ok && !erros.length ? 'concluido' : ok ? 'parcial' : 'erro';
  await posts.update(post.id, { status, error: erros.join(' | ') });
  broadcast('posts', { action: 'created' }, post.usuarioId);
}

async function processarComentarioFixado({ accountId, mediaId, texto }) {
  const conta = await accounts.findById(accountId);
  if (!conta) return;
  try {
    await graph.comentar(conta, mediaId, texto);
    console.log(`💬 [Comentário] @${conta.username}: publicado`);
  } catch (err) {
    // Não relança: o post já está no ar, e repetir comentaria duas vezes.
    console.log(`⚠️ [Comentário] @${conta.username}: ${err.message}`);
  }
}

function handlers() {
  const executor = require('./services/campaignExecutor');
  return {
    job_round: processarRodada,
    post: processarPost,
    comentario_fixado: processarComentarioFixado,
    story: dados => require('./services/stories').processar(dados),
    campanha_publicacao: ({ campaignPublicationId }) => executor.processarPublicacao(campaignPublicationId, {
      publicarNaConta: (conta, post) => publicarNaConta(conta, post),
      broadcast,
    }),
    campanha_comentario: ({ campaignCommentId }) => executor.processarComentario(campaignCommentId, {
      comentarNaConta: async (conta, { mediaId, text }) => ({ commentId: await graph.comentar(conta, mediaId, text), mediaId }),
      broadcast,
    }),
  };
}

/**
 * Consistência na subida: travas órfãs soltas, e envio ativo sem rodada na
 * fila ganha a rodada de volta (o que estava em 'running' já volta sozinho
 * pela recuperação da própria fila).
 */
async function recuperar() {
  await accounts.destravarVencidas();
  await sql`update posts set status = 'erro', error = 'Processamento interrompido — servidor reiniciado'
            where status = 'processando' and updated_at < now() - interval '30 minutes'
              and (job_id is null or job_id not in (select id from jobs where status = 'running'))`;
  const orfaos = await sql`
    select id from jobs j where status = any(${ESTADOS_ATIVOS})
      and not exists (select 1 from queue_jobs q where q.name = 'job_round' and q.data->>'jobId' = j.id::text)`;
  for (const { id } of orfaos) {
    await jobs.update(id, { status: 'queued' });
    await agendarRodada(id, 0);
    console.log(`♻️  [Envio] ${id} sem rodada na fila — reagendado`);
  }
  await require('./jobs/campaignRecovery').recuperarCampanhas().catch(e => console.log('[Campanha] recuperação:', e.message));
}

async function iniciarWorker() {
  await recuperar();
  setInterval(() => accounts.destravarVencidas().catch(() => {}), 60_000);
  setInterval(() => require('./jobs/campaignRecovery').recuperarCampanhas().catch(() => {}), 5 * 60_000);
  await fila.iniciar(handlers(), { concorrencia: Number(process.env.WORKER_CONCURRENCY) || 5 });
}

module.exports = { iniciarWorker, publicarNaConta, podePublicarAgora, agendarRodada, processarRodada, recuperar };
