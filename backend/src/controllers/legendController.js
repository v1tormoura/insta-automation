'use strict';

/** Legendas salvas. */

const { sql } = require('../db');
const { legends } = require('../repos');

exports.createLegend = async (req, res) => {
  if (!String(req.body.title || '').trim() || !String(req.body.text || '').trim()) {
    return res.status(400).json({ error: 'Título e texto são obrigatórios' });
  }
  res.json(await legends.insert({
    title: req.body.title,
    category: req.body.category || 'Geral',
    text: req.body.text,
    isActive: req.body.isActive !== false,
  }));
};

/* Favoritas primeiro, depois as mais novas. */
exports.getLegends = async (req, res) => {
  res.json(await legends.findMany({}, { orderBy: 'favorita desc, created_at desc' }));
};

/** Atualiza só o que veio no corpo: favoritar não pode apagar o texto. */
exports.updateLegend = async (req, res) => {
  const campos = {};
  if (typeof req.body.title === 'string') campos.title = req.body.title;
  if (typeof req.body.category === 'string') campos.category = req.body.category || 'Geral';
  if (typeof req.body.text === 'string') campos.text = req.body.text;
  if (typeof req.body.isActive === 'boolean') campos.isActive = req.body.isActive;
  if (typeof req.body.favorita === 'boolean') campos.favorita = req.body.favorita;
  if (!Object.keys(campos).length) return res.status(400).json({ error: 'Nada para atualizar', code: 'CORPO_VAZIO' });

  const legenda = await legends.update(req.params.id, campos);
  if (!legenda) return res.status(404).json({ error: 'Legenda não encontrada' });
  res.json(legenda);
};

exports.deleteLegend = async (req, res) => {
  await legends.remove(req.params.id);
  res.json({ success: true });
};

exports.getRandomLegend = async (req, res) => {
  const [legenda] = await sql`
    select * from legends where is_active
    ${req.query.category ? sql`and category = ${String(req.query.category)}` : sql``}
    order by random() limit 1`;
  if (!legenda) return res.status(404).json({ error: 'Nenhuma legenda encontrada' });
  res.json(legenda);
};
