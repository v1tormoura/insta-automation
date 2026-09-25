'use strict';

/**
 * Operações sobre as contas conectadas pela API oficial.
 *
 * Um ciclo só, a cada 5 minutos, faz o que antes eram três jobs batendo no
 * mesmo `/me`: atualiza perfil e avatar, registra a série de seguidores,
 * decide a saúde da conta e renova o token antes de vencer.
 *
 * A conta só muda de estado quando o Instagram diz algo sobre ELA. Timeout,
 * limite de chamadas e erro de rede são transitórios e não mexem na saúde —
 * senão um tropeço de rede derrubaria a conta no painel.
 */

const { sql } = require('../db');
const accounts = require('../repos/accounts');
const graph = require('./instagramAPI');
const avatarLocal = require('./avatarLocal');
const verificacao = require('./verificacaoDoInstagram');
const { broadcast } = require('../events/broadcaster');

const RENOVAR_ANTES_MS = 15 * 24 * 60 * 60 * 1000;
const AVISAR_ANTES_DIAS = 7;
const INTERVALO_MS = 5 * 60 * 1000;
const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * O que um erro da Graph diz sobre a conta.
 * @returns {{status: string, mensagem: string}|null} null = transitório, não mexe na saúde.
 */
function classificarErro(err) {
  const msg = String(err?.message || err || '');
  const code = Number(err?.code) || 0;
  const subcode = Number(err?.subcode) || 0;

  // Limites de chamada (4, 17, 32, 613) e falhas de rede passam sozinhos.
  if ([4, 17, 32, 613].includes(code) || /rate limit|please wait|try again later|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) {
    return null;
  }
  // "Confirme que você é humano" chega como 190, mas não é token vencido:
  // reconectar não resolve; resolver no instagram.com resolve.
  if (verificacao.ehVerificacaoPendente(msg)) {
    return { status: 'restrita', mensagem: verificacao.MENSAGEM_DE_VERIFICACAO };
  }
  if (/account.*(disabled|banned)|has been disabled|violat.*terms/i.test(msg)) {
    return { status: 'banida', mensagem: 'Conta desativada ou suspensa pelo Instagram' };
  }
  // 2207050: a Meta restringiu a publicação desta conta (leitura segue normal).
  if (code === 2207050 || subcode === 2207050 || /checkpoint|feedback_required|action_blocked|spam/i.test(msg)) {
    return { status: 'restrita', mensagem: `Instagram restringiu a conta: ${msg.slice(0, 160)}` };
  }
  if (code === 190 || err?.type === 'OAuthException' || [460, 463, 467].includes(subcode)
      || /token.*(invalid|expired)|(invalid|expired).*token|session.*(invalid|expired)/i.test(msg)) {
    const motivo = subcode === 460 ? 'Senha do Instagram alterada'
      : subcode === 463 ? 'Token expirado'
      : subcode === 467 ? 'Autorização revogada'
      : /malformed|invalid user id/i.test(msg) ? 'O Instagram não reconhece mais o usuário deste token — a conta pode ter sido desativada'
      : 'Token inválido';
    return { status: 'token_invalido', mensagem: `${motivo} — reconecte a conta em Contas` };
  }
  return null;
}

/** Restrição de PUBLICAÇÃO: o `/me` segue respondendo, então o sync não pode apagá-la. */
function ehRestricaoDePublicacao(conta) {
  return conta.healthStatus === 'restrita' && /restring|2207050/i.test(conta.lastError || '');
}

async function renovar(conta) {
  const { token, expiraEm } = await graph.renovarToken(conta.accessToken);
  console.log(`🔄 [Contas] @${conta.username} — token renovado até ${expiraEm.toLocaleDateString('pt-BR')}`);
  return { accessToken: token, tokenExpiresAt: expiraEm };
}

/**
 * Sincroniza uma conta: perfil, avatar, série de seguidores, saúde e token.
 * Nunca lança por causa do Instagram — o resultado vai para a conta.
 * @returns {Promise<object|null>} a conta atualizada
 */
async function sincronizar(conta) {
  if (!conta?.accessToken || !conta?.igUserId) return conta;
  const agora = new Date();
  const update = { lastSync: agora, lastHealthCheck: agora };
  const venceEm = conta.tokenExpiresAt ? new Date(conta.tokenExpiresAt) : null;

  try {
    const p = await graph.perfil(conta.accessToken);
    Object.assign(update, {
      username: p.username || conta.username,
      name: p.name || conta.name,
      accountType: p.accountType || conta.accountType,
      ...(p.followers !== null ? { followers: p.followers } : {}),
      ...(p.following !== null ? { following: p.following } : {}),
      ...(p.postsCount !== null ? { postsCount: p.postsCount } : {}),
    });
    if (p.accountType === 'personal') {
      Object.assign(update, {
        healthStatus: 'conta_pessoal',
        lastError: 'Conta pessoal — mude para conta profissional no Instagram (Configurações → Tipo de conta) e reconecte',
      });
    } else if (!ehRestricaoDePublicacao(conta)) {
      Object.assign(update, { healthStatus: 'ativa', lastError: '' });
    }
    if (avatarLocal.fotoMudou(p.avatarUrl, conta.avatarOrigem, conta.avatar)) {
      const local = await avatarLocal.baixarAvatar(p.avatarUrl, update.username);
      if (local) Object.assign(update, { avatar: local, avatarOrigem: avatarLocal.origemDaFoto(p.avatarUrl) });
    }
    if (venceEm && venceEm - agora < RENOVAR_ANTES_MS) {
      Object.assign(update, await renovar(conta).catch(e => {
        console.log(`⚠️ [Contas] @${conta.username} — renovação antecipada falhou: ${e.message}`);
        return {};
      }));
    }
  } catch (err) {
    let c = classificarErro(err);
    // Token recusado mas ainda no prazo: a renovação às vezes o recupera.
    if (c?.status === 'token_invalido' && (!venceEm || venceEm > agora)) {
      const renovado = await renovar(conta).catch(() => null);
      if (renovado) { Object.assign(update, renovado, { healthStatus: 'ativa', lastError: '' }); c = null; }
    }
    if (c) {
      Object.assign(update, { healthStatus: c.status, lastError: c.mensagem });
      if (c.status === 'banida') {
        update.status = 'banida';
        cancelarTrabalho(conta.id, `Conta @${conta.username} suspensa pelo Instagram`).catch(() => {});
      }
    } else if (!update.healthStatus) {
      console.log(`⚠️ [Contas] @${conta.username} — sync falhou (transitório): ${err.message}`);
    }
  }

  const salva = await accounts.update(conta.id, update);
  if (salva) {
    await require('./serieDeSeguidores').registrar(salva);
    const dias = salva.tokenExpiresAt ? Math.ceil((new Date(salva.tokenExpiresAt) - agora) / 86_400_000) : null;
    if (dias !== null && dias >= 0 && dias <= AVISAR_ANTES_DIAS) {
      require('./smartActivity/eventosDePublicacao').notificarTokenExpirando({ conta: salva, dias })
        .catch(e => console.log('[Aviso] token expirando falhou:', e.message));
    }
    broadcast('accounts', { action: 'health_update', accountId: salva.id, username: salva.username, healthStatus: salva.healthStatus }, salva.usuarioId);
  }
  return salva;
}

let _rodando = false;

/**
 * Sincroniza as contas conectadas, uma de cada vez — todas (o ciclo do
 * servidor) ou só as de um usuário (o botão "Sincronizar todas").
 */
async function sincronizarTodas(usuarioId = null) {
  if (_rodando && !usuarioId) return;
  if (!usuarioId) _rodando = true;
  try {
    const lista = await sql`
      select id, usuario_id from accounts
      where access_token <> '' and ig_user_id <> '' and status <> 'banida' and is_busy = false
        ${usuarioId ? sql`and usuario_id = ${usuarioId}` : sql``}
      order by last_sync nulls first`;
    for (const { id } of lista) {
      const conta = await accounts.findById(id);
      if (conta && !conta.isBusy) await sincronizar(conta).catch(e => console.log(`⚠️ [Contas] ${e.message}`));
      await delay(1500);
    }
    for (const dono of new Set(lista.map(c => c.usuarioId))) {
      broadcast('accounts', { action: 'synced', count: lista.filter(c => c.usuarioId === dono).length }, dono);
    }
  } finally {
    if (!usuarioId) _rodando = false;
  }
}

function iniciarSincronizacao() {
  setTimeout(() => sincronizarTodas().catch(e => console.log('[Contas] ciclo falhou:', e.message)), 30_000);
  setInterval(() => sincronizarTodas().catch(e => console.log('[Contas] ciclo falhou:', e.message)), INTERVALO_MS);
}

/**
 * Tira a conta de todo trabalho em andamento: envios ativos perdem a conta (e
 * são cancelados se ficarem sem nenhuma); publicações pendentes também.
 */
async function cancelarTrabalho(accountId, motivo = 'Conta removida ou suspensa') {
  await sql.begin(async tx => {
    await tx`
      update jobs set account_ids = array_remove(account_ids, ${accountId}::uuid)
      where ${accountId}::uuid = any(account_ids)
        and status in ('queued', 'running', 'waiting_interval', 'paused')`;
    await tx`
      update jobs set status = 'cancelled', last_error = ${motivo}
      where cardinality(account_ids) = 0 and status in ('queued', 'running', 'waiting_interval', 'paused')`;
    await tx`
      update posts set account_ids = array_remove(account_ids, ${accountId}::uuid)
      where ${accountId}::uuid = any(account_ids) and status in ('pendente', 'processando', 'erro')`;
    await tx`delete from posts where cardinality(account_ids) = 0 and status in ('pendente', 'processando', 'erro')`;
  });
}

/** Apaga a conta e o que só existia por causa dela. */
async function remover(accountId) {
  const conta = await accounts.findById(accountId);
  if (!conta) return false;
  await cancelarTrabalho(accountId, 'Conta excluída pelo usuário');
  await accounts.remove(accountId);
  return true;
}

module.exports = {
  classificarErro, sincronizar, sincronizarTodas, iniciarSincronizacao, cancelarTrabalho, remover,
};
