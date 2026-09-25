'use strict';

/** Painel: números da operação, fila, próximas publicações e postagens ao vivo. */

const { sql } = require('../db');
const { comContas } = require('../repos');
const { somarFilas, postagensDeHoje, porStatus, contarJobs } = require('./contagemDaFila');

const FUSO = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
const ATIVOS = ['queued', 'running', 'waiting_interval'];
const PROBLEMAS = ['banida', 'restrita', 'token_invalido'];

function inicioDoDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
const diasAtras = n => new Date(Date.now() - n * 86_400_000);

/** Série diária dos últimos `dias`, com zero nos dias sem registro. */
function serieDiaria(linhas, dias, campo) {
  const mapa = Object.fromEntries(linhas.map(r => [r.dia, r.n]));
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dia = d.toLocaleDateString('en-CA');
    serie.push({ date: dia, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), [campo]: mapa[dia] || 0 });
  }
  return serie;
}

function porDia(status, desde) {
  return sql`
    select to_char((updated_at at time zone ${FUSO})::date, 'YYYY-MM-DD') as dia, count(*) as n
    from posts where status = any(${status}) and updated_at >= ${desde}
    group by 1`;
}

/** Envios ativos cujas contas não estão todas banidas ou apagadas. */
async function enviosAtivos() {
  const lista = await sql`select * from jobs where status = any(${ATIVOS})`;
  await comContas(lista, ['id', 'username', 'avatar', 'healthStatus']);
  return lista.filter(j => j.accounts.some(a => a.healthStatus !== 'banida'));
}

/**
 * Cada rodada restante de um envio vira um item "próximo", com o horário
 * previsto. Loop projeta no máximo 5 rodadas, para não poluir a previsão.
 */
function enviosComoProximos(lista) {
  const itens = [];
  const agora = Date.now();
  for (const job of lista) {
    if (!job.mediaFiles?.length || !job.accounts?.length) continue;
    const total = job.mediaFiles.length;
    const limite = Math.max(1, job.simultaneousLimit || 1);
    const rodadas = Math.ceil(total / limite);
    const intervalo = (job.intervalMinutes || 0) * 60_000;
    const base = job.status === 'waiting_interval' && job.nextRoundAt ? new Date(job.nextRoundAt).getTime() : agora;
    const inicio = job.currentRound || 0;
    const fim = job.type === 'loop' ? inicio + Math.min(5, rodadas) : rodadas;

    for (let rodada = inicio; rodada < fim; rodada++) {
      const de = (rodada % rodadas) * limite;
      if (de >= total) break;
      const atual = rodada === inicio;
      const status = atual && job.status === 'running' ? 'processando'
        : atual && job.status === 'queued' ? 'pendente' : 'agendado';
      for (const media of job.mediaFiles.slice(de, Math.min(de + limite, total))) {
        itens.push({
          id: `job-${job.id}-r${rodada}-${media}`,
          media,
          postType: job.postType || 'reel',
          caption: job.caption || '',
          accounts: job.accounts,
          scheduledAt: new Date(base + (rodada - inicio) * intervalo),
          status,
          _isJob: true,
          _jobId: job.id,
          _jobName: job.name || '',
          _round: rodada,
        });
      }
    }
  }
  return itens;
}

async function bancoResponde() {
  try { await sql`select 1`; return true; } catch { return false; }
}

exports.getDashboard = async (req, res) => {
  const hoje = inicioDoDia();
  const seteDias = diasAtras(7);
  const trintaDias = diasAtras(30);

  const [
    contas, [contagem], campanhaPorStatus, [{ n: pubsHoje }], ativos,
    avulsosProximos, diarios, errosDiarios, engajamento,
  ] = await Promise.all([
    sql`select id, health_status, access_token, ig_user_id, daily_post_limit, posts_today, created_at, updated_at from accounts`,
    sql`
      select count(*) as total,
        count(*) filter (where status = 'concluido') as concluidos,
        count(*) filter (where status = 'parcial') as parciais,
        count(*) filter (where status = 'erro') as erros,
        count(*) filter (where status = 'agendado' and job_id is null) as agendados,
        count(*) filter (where status = 'processando' and job_id is null) as processando,
        count(*) filter (where status = 'pendente' and job_id is null) as pendentes,
        count(*) filter (where status in ('concluido', 'parcial') and updated_at >= ${hoje}) as hoje,
        count(*) filter (where status = 'erro' and updated_at >= ${hoje}) as erros_hoje
      from posts`,
    sql`select status, count(*) as n from campaign_publications
        where status in ('pending', 'scheduled', 'processing') group by status`,
    sql`select count(*) as n from campaign_publications where status = 'published' and published_at >= ${hoje}`,
    enviosAtivos(),
    sql`select * from posts where status in ('agendado', 'pendente', 'processando') and job_id is null
        order by scheduled_at asc nulls last limit 200`,
    porDia(['concluido', 'parcial'], diasAtras(90)),
    porDia(['erro'], seteDias),
    sql`
      select i.account_id, max(a.username) as username, max(a.avatar) as avatar,
        avg(i.video_views) as avg_views, avg(i.like_count) as avg_likes, avg(i.comments_count) as avg_comments,
        sum(i.video_views) as total_views, sum(i.like_count) as total_likes, count(*) as total_posts
      from insights i join accounts a on a.id = i.account_id
      where i.posted_at >= ${trintaDias} and a.health_status <> 'banida'
      group by i.account_id order by total_views desc limit 10`,
  ]);

  const { rodando, enfileirados } = contarJobs(ativos);
  const fila = somarFilas(
    { agendados: contagem.agendados, processando: contagem.processando, pendentes: contagem.pendentes },
    { rodando, enfileirados },
    porStatus(campanhaPorStatus),
  );

  await comContas(avulsosProximos);
  const upcomingPosts = [...avulsosProximos, ...enviosComoProximos(ativos)]
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0))
    .slice(0, 200);

  const finalizados = contagem.concluidos + contagem.erros + contagem.parciais;
  const comLimite = contas.filter(a => a.dailyPostLimit && a.dailyPostLimit < 999999);
  const criadas = desde => contas.filter(a => new Date(a.createdAt) >= desde).length;
  const comProblema = desde => contas.filter(a => PROBLEMAS.includes(a.healthStatus) && (!desde || new Date(a.updatedAt) >= desde)).length;
  const banco = await bancoResponde();

  res.json({
    totalAccounts: contas.length,
    activeAccounts: contas.filter(a => a.healthStatus === 'ativa' || (a.accessToken && a.igUserId && !PROBLEMAS.includes(a.healthStatus))).length,
    cooldownAccounts: contas.filter(a => a.dailyPostLimit > 0 && (a.postsToday || 0) >= a.dailyPostLimit).length,

    totalPosts: contagem.total,
    scheduledPosts: fila.agendados,
    processingPosts: fila.processando,
    pendingPosts: fila.pendentes,
    successRate: finalizados > 0 ? Math.round((contagem.concluidos / finalizados) * 100) : 100,

    postsToday: postagensDeHoje(contagem.hoje, pubsHoje),
    errorsToday: contagem.errosHoje,
    dailyPostLimit: comLimite.reduce((soma, a) => soma + a.dailyPostLimit, 0),

    upcomingPosts,
    dailyPosts: serieDiaria(diarios, 90, 'posts'),
    dailyErrors7d: serieDiaria(errosDiarios, 7, 'errors'),

    accountsAddedToday: criadas(hoje),
    accountsAdded7d: criadas(seteDias),
    accountsAdded30d: criadas(trintaDias),
    problemsToday: comProblema(hoje),
    problems7d: comProblema(seteDias),
    problems30d: comProblema(null),

    avgEngagementByAccount: engajamento.map(r => ({
      accountId: r.accountId,
      username: r.username,
      avatar: r.avatar || null,
      avgViews: Math.round(r.avgViews || 0),
      avgLikes: Math.round(r.avgLikes || 0),
      avgComments: Math.round(r.avgComments || 0),
      totalViews: Math.round(r.totalViews || 0),
      totalLikes: Math.round(r.totalLikes || 0),
      totalPosts: r.totalPosts,
    })),

    system: { backend: true, banco, worker: banco },
  });
};

exports.getAccountStats = async (req, res) => {
  const hoje = inicioDoDia();
  const seteDias = diasAtras(7);
  const trintaDias = diasAtras(30);

  const [contas, publicacoes, crescimento] = await Promise.all([
    sql`select id, username, avatar, followers, following, posts_count, health_status, access_token,
          token_expires_at, ig_user_id, last_sync, last_post_at from accounts`,
    sql`
      select conta as account_id,
        count(*) filter (where status in ('concluido', 'parcial')) as posts30d,
        count(*) filter (where status in ('concluido', 'parcial') and updated_at >= ${seteDias}) as posts7d,
        count(*) filter (where status in ('concluido', 'parcial') and updated_at >= ${hoje}) as posts_today,
        count(*) filter (where status = 'erro') as failures30d,
        count(*) filter (where status = 'erro' and updated_at >= ${seteDias}) as failures7d,
        count(*) filter (where status = 'erro' and updated_at >= ${hoje}) as failures_today
      from posts, unnest(account_ids) as conta
      where updated_at >= ${trintaDias}
      group by conta`,
    sql`
      select distinct on (account_id) account_id,
        seguidores - first_value(seguidores) over (partition by account_id order by dia) as ganho
      from seguidores_do_dia
      where dia >= ${trintaDias.toLocaleDateString('en-CA')}
      order by account_id, dia desc`,
  ]);

  const porConta = new Map(publicacoes.map(p => [p.accountId, p]));
  const ganho = new Map(crescimento.map(g => [g.accountId, g.ganho]));
  const agora = new Date();

  const lista = contas.map(c => {
    const p = porConta.get(c.id) || {};
    const ok = p.posts30d || 0, falhas = p.failures30d || 0;
    let status = 'ativa';
    if (c.healthStatus === 'banida') status = 'banida';
    else if (c.healthStatus === 'token_invalido') status = 'token_expired';
    else if (c.healthStatus === 'restrita') status = 'restrita';
    else if (c.accessToken && c.tokenExpiresAt && new Date(c.tokenExpiresAt) < agora) status = 'token_expired';
    else if (c.accessToken && c.igUserId) status = 'connected';

    return {
      id: c.id, username: c.username, avatar: c.avatar || '',
      followers: c.followers, following: c.following, postsCount: c.postsCount,
      postsToday: p.postsToday || 0, posts7d: p.posts7d || 0, posts30d: ok,
      failuresToday: p.failuresToday || 0, failures7d: p.failures7d || 0, failures30d: falhas,
      successRate: ok + falhas > 0 ? Math.round((ok / (ok + falhas)) * 100) : 0,
      growth30d: ganho.get(c.id) || 0,
      status, healthStatus: c.healthStatus,
      lastSync: c.lastSync || c.lastPostAt || null,
    };
  });

  lista.sort((a, b) => b.posts30d - a.posts30d);
  res.json(lista);
};

exports.getLivePosts = async (req, res) => {
  const umaHora = new Date(Date.now() - 3_600_000);
  const campos = ['id', 'username', 'avatar'];

  const [processando, naFila, erros, concluidos, ativos] = await Promise.all([
    sql`select * from posts where status = 'processando' order by updated_at desc limit 10`,
    sql`select * from posts where status in ('pendente', 'agendado') order by scheduled_at asc nulls last, created_at asc limit 30`,
    sql`select * from posts where status = 'erro' and updated_at >= ${umaHora} order by updated_at desc limit 15`,
    sql`select * from posts where status in ('concluido', 'parcial') and updated_at >= ${umaHora} order by updated_at desc limit 15`,
    enviosAtivos(),
  ]);
  await comContas([...processando, ...naFila, ...erros, ...concluidos], campos);

  const rodando = ativos
    .filter(j => j.status === 'running')
    .map(j => ({ id: j.id, accounts: j.accounts, caption: j.caption || j.name || '', status: 'processando', updatedAt: j.updatedAt, error: j.lastError || '' }));

  res.json({
    processing: [...processando, ...rodando].slice(0, 10),
    queue: [...naFila, ...enviosComoProximos(ativos)]
      .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0))
      .slice(0, 30),
    errors: erros,
    completed: concluidos,
  });
};
