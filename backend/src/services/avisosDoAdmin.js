'use strict';

/** Avisos para o admin sobre a plataforma — hoje, só o cadastro novo esperando aprovação. */

const { sql } = require('../db');

async function novoCadastro(u) {
  const [admin] = await sql`select id from usuarios where papel = 'admin' order by created_at limit 1`;
  if (!admin) return null;
  // O texto vem do modelo editável "Novo cadastro" (Notificações).
  const t = require('./smartActivity/templates');
  const cfg = await require('./smartActivity/thresholds').carregar(admin.id).catch(() => null);
  if (cfg?.ativos?.novoCadastro === false) return null;
  const modelo = t.modeloDe('novoCadastro', cfg?.mensagens);
  const vars = { nomeCadastro: u.nome || '', emailCadastro: u.email || '' };
  const [nova] = await sql`
    insert into notificacoes ${sql({
      usuarioId: admin.id,
      eventType: 'cadastro',
      tema: modelo.tema,
      prioridade: 'alta',
      titulo: t.render(modelo.titulo, vars),
      mensagem: t.render(modelo.mensagem, vars),
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
