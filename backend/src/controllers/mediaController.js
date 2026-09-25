'use strict';

/** Biblioteca de mídia: listar, enviar, apagar, mover e pastas. */

const fs = require('fs');
const path = require('path');
const { sql } = require('../db');
const { media: tabela } = require('../repos');
const { garantirMiniatura, nomeDaMiniatura } = require('../services/miniaturaDeVideo');

const UPLOADS = path.resolve(__dirname, '../../uploads');
// Pasta vazia existe como um item marcador, que as telas escondem.
const marcador = pasta => `__folder_${pasta}__`;

function tipoDe(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

// GET /media?folder=&search=&type=&limit=&skip= — sem parâmetros, a biblioteca inteira.
exports.getMedia = async (req, res) => {
  const partes = [];
  if (req.query.folder) partes.push(sql`folder = ${String(req.query.folder)}`);
  if (['image', 'video', 'other'].includes(req.query.type)) partes.push(sql`type = ${req.query.type}`);
  const busca = String(req.query.search || '').trim();
  if (busca) {
    const padrao = `%${busca.replace(/[\\%_]/g, c => '\\' + c)}%`;
    partes.push(sql`(original_name ilike ${padrao} or filename ilike ${padrao})`);
  }
  const onde = partes.length ? partes.reduce((a, b) => sql`${a} and ${b}`) : sql`true`;
  const limite = Math.min(500, Math.max(0, Number(req.query.limit) || 0));
  const pular = Math.max(0, Number(req.query.skip) || 0);

  const [files, [{ total }], pastas] = await Promise.all([
    sql`select * from media where ${onde} order by created_at desc ${limite ? sql`limit ${limite}` : sql``} offset ${pular}`,
    sql`select count(*) as total from media where ${onde}`,
    sql`select distinct folder from media order by folder`,
  ]);
  res.json({ files, folders: pastas.map(p => p.folder || 'default'), total });
};

// POST /media/upload (body: folder) — aceita qualquer nome de campo.
exports.uploadMedia = async (req, res) => {
  const folder = req.body.folder || 'default';
  const criados = [];
  for (const file of req.files || []) {
    criados.push(await tabela.insert({
      filename: file.filename,
      originalName: file.originalname,
      path: file.filename,
      url: `/uploads/${file.filename}`,
      mimeType: file.mimetype,
      size: file.size,
      type: tipoDe(file.mimetype),
      folder,
    }));
    // A miniatura sai em segundo plano: a resposta não espera o ffmpeg.
    garantirMiniatura(UPLOADS, file.filename).catch(e => console.log('[Miniatura] falhou:', file.filename, e.message));
  }
  // `files` é alias de `media`: as duas telas que usam a rota leem chaves diferentes.
  res.json({ success: true, total: criados.length, media: criados, files: criados });
};

exports.deleteMedia = async (req, res) => {
  const item = await tabela.remove(req.params.id);
  if (!item) return res.status(404).json({ error: 'Mídia não encontrada' });
  if (item.filename && !item.filename.startsWith('__folder_')) {
    for (const nome of [item.filename, nomeDaMiniatura(item.filename)]) {
      const alvo = path.resolve(UPLOADS, nome);
      if (alvo.startsWith(UPLOADS + path.sep)) fs.rmSync(alvo, { force: true });
    }
  }
  res.json({ success: true });
};

exports.moveMedia = async (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder obrigatório' });
  const item = await tabela.update(req.params.id, { folder });
  if (!item) return res.status(404).json({ error: 'Mídia não encontrada' });
  res.json(item);
};

exports.createFolder = async (req, res) => {
  const nome = String(req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9_\-\s]/g, '').trim();
  if (!nome) return res.status(400).json({ error: req.body.name ? 'Nome inválido' : 'Nome obrigatório' });
  const [existe] = await sql`select 1 from media where folder = ${nome} limit 1`;
  if (!existe) {
    await tabela.insert({ filename: marcador(nome), originalName: marcador(nome), type: 'other', folder: nome });
  }
  res.json({ success: true, folder: nome });
};

// DELETE /media/folder/:name — as mídias voltam para "default".
exports.deleteFolder = async (req, res) => {
  const nome = req.params.name;
  if (nome === 'default') return res.status(400).json({ error: 'Pasta default não pode ser excluída' });
  await sql`delete from media where folder = ${nome} and filename = ${marcador(nome)}`;
  await sql`update media set folder = 'default' where folder = ${nome}`;
  res.json({ success: true });
};
