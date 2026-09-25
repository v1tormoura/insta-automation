'use strict';

/** Avisos para o admin sobre a plataforma — hoje, só o cadastro novo esperando aprovação. */

const { sql } = require('../db');

async function novoCadastro(u) {
  const [admin] = await sql`select id from usuarios where papel = 'admin' order by created_at limit 1`;
  if (!admin) return null;
  const [nova] = await sql`
    insert into notificacoes ${sql({
      usuarioId: admin.id,
      eventType: 'cadastro',
      tema: 'info',
      prioridade: 'alta',
      titulo: 'Novo cadastro esperando aprovação',
      mensagem: `${u.nome} (${u.email}) pediu acesso. Aprove em Usuários.`,
      metadados: { usuarioId: u.id },
    })}
    returning *`;
  const webPush = require('./smartActivity/webPush');
  if (webPush.disponivel()) webPush.enviar(nova).catch(() => {});
  require('../events/broadcaster').broadcast('notificacoes', { novas: 1 }, admin.id);
  require('../events/broadcaster').broadcast('usuarios', { action: 'novo_cadastro' }, admin.id);
  return nova;
}

module.exports = { novoCadastro };
