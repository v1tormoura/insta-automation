'use strict';

/**
 * Web Push (VAPID): entrega as notificações da Central aos aparelhos inscritos.
 * As chaves vêm do .env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) ou, sem elas, de
 * um par gerado na primeira subida e guardado no banco (`prepararChaves`).
 * Sem nenhuma das duas, tudo vira no-op e a Central segue funcionando sozinha. Inscrição que o serviço de push dá como morta (404/410)
 * sai; outras falhas contam, e com 8 falhas a inscrição para de receber.
 */

const { sql } = require('../../db');

let webpush = null;
let configurado = false;
let doBanco = null; // { publica, privada } gerado por prepararChaves

const _publica = () => (process.env.VAPID_PUBLIC_KEY || '').trim() || doBanco?.publica || '';
const _privada = () => (process.env.VAPID_PRIVATE_KEY || '').trim() || doBanco?.privada || '';

function _carregar() {
  if (configurado) return webpush;
  const publica = _publica();
  const privada = _privada();
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
const chavePublica = () => _publica() || null;

/**
 * Garante um par de chaves sem ninguém precisar gerar à mão. O .env, se tiver,
 * manda. Senão, usa o par guardado no banco — e gera um na primeira vez. É
 * gerado UMA vez e reaproveitado: trocar de par invalidaria as inscrições dos
 * aparelhos, que ficam presas à chave pública com que foram feitas.
 * A privada vai cifrada (ENCRYPTION_KEY), como os tokens do Instagram.
 */
async function prepararChaves() {
  if ((process.env.VAPID_PUBLIC_KEY || '').trim() && (process.env.VAPID_PRIVATE_KEY || '').trim()) return 'env';
  const settings = require('../../repos/settings');
  const { encrypt, decrypt } = require('../tokenEncryption');
  let salvo = await settings.ler('vapid');
  if (!salvo?.publica || !salvo?.privada) {
    const par = require('web-push').generateVAPIDKeys();
    salvo = { publica: par.publicKey, privada: encrypt(par.privateKey) };
    await settings.gravar('vapid', salvo);
    console.log('🔑 [WebPush] chaves geradas e guardadas no banco');
  }
  doBanco = { publica: salvo.publica, privada: decrypt(salvo.privada) };
  configurado = false; // relê na próxima chamada
  return 'banco';
}

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

module.exports = { disponivel, chavePublica, prepararChaves, enviar, inscrever, cancelar, estado };
