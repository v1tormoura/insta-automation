'use strict';

/**
 * Web Push (VAPID): entrega as notificações da Central aos aparelhos inscritos.
 * Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, tudo vira no-op e a Central segue
 * funcionando sozinha. Inscrição que o serviço de push dá como morta (404/410)
 * sai; outras falhas contam, e com 8 falhas a inscrição para de receber.
 */

const { sql } = require('../../db');

let webpush = null;
let configurado = false;

function _carregar() {
  if (configurado) return webpush;
  const publica = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privada = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const contato = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
  configurado = true;
  if (!publica || !privada) return null;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(contato, publica, privada);
  } catch (err) {
    console.warn('[WebPush] não foi possível configurar:', err.message);
    webpush = null;
  }
  return webpush;
}

const disponivel = () => !!_carregar();
const chavePublica = () => (process.env.VAPID_PUBLIC_KEY || '').trim() || null;

function _payload(n) {
  return JSON.stringify({
    id: String(n.id || ''),
    titulo: n.titulo || 'Nexora',
    mensagem: n.mensagem || '',
    tema: n.tema || 'milestone',
    username: n.username || '',
    url: '/',
  });
}

/** Entrega aos aparelhos do dono da notificação (`notificacao.usuarioId`). */
async function enviar(notificacao) {
  const wp = _carregar();
  if (!wp || !notificacao?.usuarioId) return { enviados: 0, removidos: 0 };

  const inscricoes = await sql`select * from push_subscriptions where falhas < 8 and usuario_id = ${notificacao.usuarioId}`;
  if (!inscricoes.length) return { enviados: 0, removidos: 0 };

  const corpo = _payload(notificacao);
  let enviados = 0, removidos = 0;
  await Promise.all(inscricoes.map(async ins => {
    try {
      // Uma hora de TTL: marco velho não interessa mais.
      await wp.sendNotification({ endpoint: ins.endpoint, keys: ins.keys }, corpo, { TTL: 3600 });
      enviados++;
      await sql`update push_subscriptions set falhas = 0, ultimo_envio = now() where id = ${ins.id}`;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await sql`delete from push_subscriptions where id = ${ins.id}`;
        removidos++;
      } else {
        await sql`update push_subscriptions set falhas = falhas + 1 where id = ${ins.id}`;
      }
    }
  }));
  return { enviados, removidos };
}

/** O aparelho passa a ser de quem está logado nele (troca de usuário no mesmo navegador). */
async function inscrever({ endpoint, keys, aparelho }, usuarioId) {
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw Object.assign(new Error('Inscrição incompleta.'), { code: 'INSCRICAO_INVALIDA' });
  }
  await sql`
    insert into push_subscriptions (endpoint, keys, aparelho, falhas, usuario_id)
    values (${endpoint}, ${sql.json(keys)}, ${String(aparelho || '').slice(0, 120)}, 0, ${usuarioId})
    on conflict (endpoint) do update set keys = excluded.keys, aparelho = excluded.aparelho, falhas = 0,
      usuario_id = excluded.usuario_id`;
  return { ok: true };
}

async function cancelar(endpoint, usuarioId) {
  if (!endpoint) return { removidos: 0 };
  const r = await sql`delete from push_subscriptions where endpoint = ${endpoint} and usuario_id = ${usuarioId}`;
  return { removidos: r.count };
}

async function estado(endpoint, usuarioId) {
  const [[ins], [{ total }]] = await Promise.all([
    sql`select falhas, ultimo_envio, created_at from push_subscriptions where endpoint = ${endpoint} and usuario_id = ${usuarioId}`,
    sql`select count(*) as total from push_subscriptions where usuario_id = ${usuarioId}`,
  ]);
  return {
    inscrito: !!ins,
    falhas: ins?.falhas || 0,
    ultimoEnvio: ins?.ultimoEnvio || null,
    desde: ins?.createdAt || null,
    total,
    vapid: disponivel(),
  };
}

module.exports = { disponivel, chavePublica, enviar, inscrever, cancelar, estado };
