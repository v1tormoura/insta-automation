'use strict';

/**
 * Envio de e-mail por SMTP — qualquer provedor serve (Resend, Brevo, Gmail,
 * o e-mail do domínio). Sem SMTP_HOST no ambiente, não há envio e quem chama
 * sabe disso por `configurado()`.
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM
 *   Porta 465 usa TLS direto; as outras, STARTTLS.
 */

const nodemailer = require('nodemailer');

let _transporte = null;

function configurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function transporte() {
  if (_transporte) return _transporte;
  const porta = Number(process.env.SMTP_PORT) || 587;
  _transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    secure: porta === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  return _transporte;
}

async function enviar({ para, assunto, texto, html }) {
  if (!configurado()) throw Object.assign(new Error('E-mail não configurado no servidor'), { code: 'EMAIL_NAO_CONFIGURADO' });
  await transporte().sendMail({ from: process.env.SMTP_FROM, to: para, subject: assunto, text: texto, html });
}

module.exports = { configurado, enviar };
