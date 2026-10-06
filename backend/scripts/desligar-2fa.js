'use strict';

/**
 * Saída de emergência: desliga o login em dois fatores de alguém — inclusive
 * do admin, que não tem outro admin para fazer isso pelo painel.
 *
 *   Na VPS:  cd /root/insta-nova && docker compose exec app node scripts/desligar-2fa.js admin
 *            (ou o e-mail do usuário no lugar de "admin")
 */

const { sql } = require('../src/db');

(async () => {
  const quem = String(process.argv[2] || '').trim().toLowerCase();
  if (!quem) { console.log('Uso: node scripts/desligar-2fa.js <admin | e-mail>'); process.exit(1); }
  const linhas = quem === 'admin'
    ? await sql`update usuarios set totp_ativo = false, totp_segredo = null, totp_ultimo_passo = null, totp_reserva = '{}', totp_ativado_em = null
                where chave = 'principal' returning email`
    : await sql`update usuarios set totp_ativo = false, totp_segredo = null, totp_ultimo_passo = null, totp_reserva = '{}', totp_ativado_em = null
                where lower(email) = ${quem} returning email`;
  console.log(linhas.length ? `✅ Dois fatores desligado para ${quem}.` : `Ninguém encontrado com "${quem}".`);
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });
