'use strict';

/**
 * Um arquivo da Biblioteca está em uso por um envio que ainda não terminou?
 *
 * Os posts apontam para o MESMO arquivo da Biblioteca (não para uma cópia).
 * Apagá-lo do disco no meio do envio deixava as contas que ainda estavam na
 * fila sem o vídeo ("No such file or directory").
 *
 * @returns {Promise<string|null>} o nome do envio que usa o arquivo, ou null
 */
async function midiaEmUso(usuarioId, filename) {
  if (!filename) return null;
  const { sql } = require('../db');
  const [job] = await sql`
    select coalesce(nullif(name, ''), 'sem nome') as nome from jobs
    where usuario_id = ${usuarioId} and ${filename} = any(media_files)
      and status in ('queued', 'running', 'waiting_interval')
    limit 1`;
  if (job) return job.nome;
  const [post] = await sql`
    select 1 from posts
    where usuario_id = ${usuarioId} and (media = ${filename} or cover = ${filename})
      and status in ('pendente', 'agendado', 'processando')
    limit 1`;
  return post ? 'envio em andamento' : null;
}

module.exports = { midiaEmUso };
