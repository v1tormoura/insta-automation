import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { hmac, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { MINUTE } from '../../lib/time.js';
import { instagramOAuthConfig, isMetaError, metaGraph } from '../../integrations/meta/index.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  exchangeForLongLived,
  fetchProfile,
} from '../../integrations/meta/instagramOAuth.js';
import { enqueueSync } from '../../queue/queues.js';
import { InstagramAccount } from '../accounts/account.model.js';
import { missingRequiredScopes, toAccountDTO, upsertFromOAuth } from '../accounts/account.service.js';
import { User } from '../auth/user.model.js';
import { notify } from '../notifications/notification.service.js';
import { emit } from '../realtime/events.js';
import { purgeAccountData } from './dataDeletion.js';
import { OAuthState } from './oauthState.model.js';

const STATE_TTL = 10 * MINUTE;

export async function startInstagramOAuth(userId: Types.ObjectId): Promise<{ url: string }> {
  const cfg = instagramOAuthConfig();
  const state = randomToken(32);
  await OAuthState.create({
    stateHash: sha256(state),
    userId,
    provider: 'instagram',
    expiresAt: new Date(Date.now() + STATE_TTL),
  });
  return { url: buildAuthorizeUrl(cfg, state) };
}

export type CallbackResult =
  | { ok: true; username: string; accountId: string; duplicate?: boolean }
  | { ok: false; error: OAuthErrorCode };

export type OAuthErrorCode =
  | 'invalid_state'
  | 'expired_state'
  | 'session_mismatch'
  | 'access_denied'
  | 'missing_permissions'
  | 'plan_limit'
  | 'meta_error'
  | 'in_progress'
  | 'not_configured';

export interface CallbackInput {
  state?: string;
  code?: string;
  error?: string;
  /** Usuário da sessão do navegador que chegou no callback (ou nenhum). */
  sessionUserId?: Types.ObjectId;
}

/**
 * Callback do OAuth. Regras:
 *  - o `state` precisa existir, estar no prazo e ser consumido UMA vez
 *    (consumo atômico: dois callbacks simultâneos não trocam o code duas vezes);
 *  - a sessão do navegador precisa ser do mesmo usuário que iniciou o fluxo —
 *    impede que alguém faça a vítima autorizar a conta dela dentro do SaaS do
 *    atacante (login CSRF invertido);
 *  - callback repetido de um state já concluído devolve o mesmo resultado.
 */
export async function handleInstagramCallback(input: CallbackInput): Promise<CallbackResult> {
  if (!input.state || input.state.length > 200) return { ok: false, error: 'invalid_state' };
  const stateHash = sha256(input.state);
  const now = new Date();

  const state = await OAuthState.findOneAndUpdate(
    { stateHash, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { returnDocument: 'after' },
  );

  if (!state) {
    const previous = await OAuthState.findOne({ stateHash }).lean();
    if (!previous) return { ok: false, error: 'invalid_state' };
    if (previous.consumedAt) {
      if (previous.outcome?.ok && previous.outcome.accountId) {
        return { ok: true, username: previous.outcome.username ?? '', accountId: previous.outcome.accountId.toString(), duplicate: true };
      }
      if (!previous.outcome) return { ok: false, error: 'in_progress' };
      return { ok: false, error: (previous.outcome.error as OAuthErrorCode) ?? 'invalid_state' };
    }
    return { ok: false, error: 'expired_state' };
  }

  const finish = async (result: CallbackResult): Promise<CallbackResult> => {
    await OAuthState.updateOne(
      { _id: state._id },
      {
        $set: {
          outcome: result.ok
            ? { ok: true, accountId: result.accountId, username: result.username }
            : { ok: false, error: result.error },
        },
      },
    );
    return result;
  };

  if (!input.sessionUserId || !input.sessionUserId.equals(state.userId)) return finish({ ok: false, error: 'session_mismatch' });
  if (input.error || !input.code) return finish({ ok: false, error: 'access_denied' });

  const user = await User.findById(state.userId).lean();
  if (!user) return finish({ ok: false, error: 'session_mismatch' });

  try {
    const cfg = instagramOAuthConfig();
    const graph = metaGraph();
    const short = await exchangeCode(graph, cfg, input.code);
    if (missingRequiredScopes(short.permissions).length) return finish({ ok: false, error: 'missing_permissions' });
    const long = await exchangeForLongLived(graph, cfg, short.accessToken);
    const profile = await fetchProfile(graph, long.accessToken);
    if (short.userId && short.userId !== profile.userId && short.userId !== profile.id) {
      logger.warn({ tokenUserId: short.userId, profileUserId: profile.userId }, 'oauth: user_id da troca difere do /me');
    }
    const account = await upsertFromOAuth(user._id, user.plan, {
      profile,
      accessToken: long.accessToken,
      expiresInSeconds: long.expiresInSeconds,
      permissions: short.permissions,
    });

    // A conta já está salva: o que vem a seguir é conveniência e não pode
    // transformar uma conexão bem-sucedida em erro para o usuário.
    const sideEffects = await Promise.allSettled([
      enqueueSync('account.quota', account._id),
      enqueueSync('account.media-insights', account._id, 10_000),
      emit(user._id, { type: 'account.updated', account: toAccountDTO(account) }),
      notify(user._id, {
        kind: 'account.connected',
        level: 'success',
        title: `@${account.username} conectada`,
        body: 'A conta está pronta para publicar.',
        link: '/accounts',
      }),
    ]);
    for (const r of sideEffects) if (r.status === 'rejected') logger.warn({ err: r.reason }, 'oauth: pós-conexão falhou');
    logger.info({ userId: user._id.toString(), accountId: account._id.toString() }, 'oauth: conta conectada');
    return finish({ ok: true, username: account.username, accountId: account._id.toString() });
  } catch (err) {
    if (err instanceof AppError && err.code === 'PLAN_LIMIT_REACHED') return finish({ ok: false, error: 'plan_limit' });
    if (err instanceof AppError && err.code === 'META_NOT_CONFIGURED') return finish({ ok: false, error: 'not_configured' });
    logger.error({ err, meta: isMetaError(err) }, 'oauth: falha no callback');
    return finish({ ok: false, error: 'meta_error' });
  }
}

/* ── Callbacks de plataforma exigidos pela Meta ─────────────────────────── */

interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
}

/** Valida o `signed_request` (HMAC-SHA256 com o app secret). */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  const [sig, payload] = signedRequest.split('.', 2);
  if (!sig || !payload) return null;
  const expected = hmac(appSecret, payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedRequestPayload;
    return data.algorithm?.toUpperCase() === 'HMAC-SHA256' ? data : null;
  } catch {
    return null;
  }
}

/** Usuário removeu o app no Instagram: todas as conexões dessa conta perdem o token. */
export async function handleDeauthorize(signedRequest: string): Promise<boolean> {
  const payload = parseSignedRequest(signedRequest, instagramOAuthConfig().appSecret);
  if (!payload?.user_id) return false;
  const res = await InstagramAccount.updateMany(
    { igUserId: String(payload.user_id), status: { $ne: 'DISCONNECTED' } },
    { $set: { status: 'DISCONNECTED', statusReason: 'Acesso removido no Instagram', disconnectedAt: new Date() }, $unset: { token: 1 } },
  ).setOptions({ crossTenant: true });
  logger.info({ affected: res.modifiedCount }, 'oauth: deauthorize recebido');
  return true;
}

/** Pedido de exclusão de dados (Data Deletion Callback). */
export async function handleDataDeletion(signedRequest: string): Promise<{ url: string; confirmation_code: string } | null> {
  const payload = parseSignedRequest(signedRequest, instagramOAuthConfig().appSecret);
  if (!payload?.user_id) return null;
  const igUserId = String(payload.user_id);
  const accounts = await InstagramAccount.find({ igUserId }).setOptions({ crossTenant: true }).select('_id userId').lean();
  for (const a of accounts) await purgeAccountData(a.userId, a._id);
  const code = randomToken(12);
  return { url: `${env.APP_URL.replace(/\/$/, '')}/privacy/deletion?code=${code}`, confirmation_code: code };
}
