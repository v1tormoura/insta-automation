'use strict';

/**
 * Envio de Web Push.
 *
 * ── Por que a biblioteca
 *
 * Entregar uma notificação push exige assinar um JWT com ECDSA sobre a curva
 * P-256 (VAPID) e cifrar o payload com AES128GCM usando um segredo derivado
 * por ECDH das chaves do navegador. Escrever isso à mão é o tipo de
 * criptografia que se erra em silêncio: o servidor de push recusa com 400 e
 * não diz o porquê. `web-push` é a implementação de referência.
 *
 * ── Por que o módulo sobrevive sem chaves
 *
 * As chaves VAPID vivem no `.env` do servidor, e uma instalação que ainda não
 * as gerou é o estado normal no primeiro deploy. Sem elas, `disponivel()`
 * devolve false e todo o resto vira no-op — o painel continua funcionando com
 * as notificações internas, que são a experiência completa. Push é o extra.
 */

const PushSubscription = require('../../models/PushSubscription');

let webpush = null;
let configurado = false;

function _carregar() {
  if (configurado) return webpush;
  const publica = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privada = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const contato = (process.env.VAPID_SUBJECT || 'mailto:admin@instaflow.pro').trim();

  if (!publica || !privada) { configurado = true; return null; }

  try {
    webpush = require('web-push');
    webpush.setVapidDetails(contato, publica, privada);
  } catch (err) {
    console.warn('[WebPush] não foi possível configurar:', err.message);
    webpush = null;
  }
  configurado = true;
  return webpush;
}

/** Há chaves e biblioteca? Sem isso, nada é enviado e nada quebra. */
function disponivel() {
  return !!_carregar();
}

/** A pública vai para o navegador; a privada NUNCA sai do servidor. */
function chavePublica() {
  return (process.env.VAPID_PUBLIC_KEY || '').trim() || null;
}

/**
 * Payload enxuto de propósito.
 *
 * O limite prático de um push é ~4KB depois de cifrado, e estourar devolve 413
 * do serviço de push. Vai só o que a notificação do sistema mostra, mais o id
 * para o clique saber onde ir — o resto o app busca quando abrir.
 */
function _payload(n) {
  return JSON.stringify({
    id: String(n._id || ''),
    titulo: n.titulo || 'MouraFlow',
    mensagem: n.mensagem || '',
    tema: n.tema || 'milestone',
    username: n.username || '',
    url: '/',
  });
}

/**
 * Envia para todos os aparelhos inscritos.
 *
 * ── O tratamento de falha, que é onde isto costuma dar errado
 *
 * 404 e 410 significam que o navegador descartou a inscrição — o aparelho foi
 * limpo, o app desinstalado, a permissão revogada. Ela nunca mais vai
 * funcionar, e mantê-la faz cada envio futuro gastar uma requisição para
 * receber o mesmo erro. Apaga.
 *
 * Qualquer outro erro é tratado como transitório e só incrementa um contador.
 * Apagar na primeira falha faria uma instabilidade de dez minutos no serviço
 * de push desinscrever todo mundo — e ninguém perceberia até parar de receber
 * notificação, semanas depois.
 */
async function enviar(notificacao) {
  const wp = _carregar();
  if (!wp || !notificacao) return { enviados: 0, removidos: 0 };

  const inscricoes = await PushSubscription.find({ falhas: { $lt: 8 } }).lean();
  if (!inscricoes.length) return { enviados: 0, removidos: 0 };

  const corpo = _payload(notificacao);
  let enviados = 0, removidos = 0;

  await Promise.all(inscricoes.map(async ins => {
    try {
      await wp.sendNotification(
        { endpoint: ins.endpoint, keys: ins.keys },
        corpo,
        { TTL: 3600 }   // uma hora: marco velho não interessa mais
      );
      enviados++;
      if (ins.falhas) {
        await PushSubscription.updateOne({ _id: ins._id },
          { $set: { falhas: 0, ultimoEnvio: new Date() } });
      } else {
        await PushSubscription.updateOne({ _id: ins._id },
          { $set: { ultimoEnvio: new Date() } });
      }
    } catch (err) {
      const codigo = err?.statusCode;
      if (codigo === 404 || codigo === 410) {
        await PushSubscription.deleteOne({ _id: ins._id });
        removidos++;
      } else {
        await PushSubscription.updateOne({ _id: ins._id }, { $inc: { falhas: 1 } });
      }
    }
  }));

  return { enviados, removidos };
}

/** Grava ou atualiza a inscrição de um aparelho. */
async function inscrever({ endpoint, keys, aparelho }) {
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    const e = new Error('Inscrição incompleta.');
    e.code = 'INSCRICAO_INVALIDA';
    throw e;
  }
  await PushSubscription.updateOne(
    { endpoint },
    { $set: { endpoint, keys, aparelho: String(aparelho || '').slice(0, 120), falhas: 0 } },
    { upsert: true }
  );
  return { ok: true };
}

async function cancelar(endpoint) {
  if (!endpoint) return { removidos: 0 };
  const r = await PushSubscription.deleteOne({ endpoint });
  return { removidos: r.deletedCount || 0 };
}

module.exports = { disponivel, chavePublica, enviar, inscrever, cancelar };
