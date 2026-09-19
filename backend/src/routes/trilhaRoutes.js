'use strict';
const path    = require('path');
const fs      = require('fs');
const router  = require('express').Router();
const multer  = require('multer');
const fsExtra = require('fs-extra');
const Trilha  = require('../models/Trilha');

/**
 * Biblioteca de trilhas de áudio — o que o Postar oferece para trocar ou
 * misturar o áudio dos vídeos por conta.
 *
 * Separada do upload do editor (`/video-templates/upload-audio`) de propósito:
 * lá o arquivo é de um template; aqui é uma biblioteca com nome, que várias
 * publicações reaproveitam e que a pessoa gerencia (vê, apaga).
 */

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');
const PASTA = 'trilhas';
const EXT_AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.join(RAIZ_UPLOADS, PASTA);
    try { await fsExtra.ensureDir(dir); cb(null, dir); } catch (e) { cb(e); }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    /* A extensão também vale: o navegador manda `video/ogg` para .ogg e
       `application/octet-stream` quando não reconhece o tipo. */
    const ok = String(file.mimetype || '').startsWith('audio/')
      || EXT_AUDIO.test(path.extname(file.originalname || ''));
    if (!ok) return cb(new Error('Apenas arquivos de áudio são permitidos'));
    cb(null, true);
  },
});

router.get('/', async (_req, res) => {
  try {
    const lista = await Trilha.find().sort({ createdAt: -1 }).lean();
    res.json(lista.map(t => ({ _id: t._id, nome: t.nome, tamanho: t.tamanho, createdAt: t.createdAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => upload.single('file')(req, res, async err => {
  if (err) return res.status(400).json({ error: err.message || 'Falha no envio do áudio' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const nome = String(req.body?.nome || '').trim()
      || path.basename(req.file.originalname, path.extname(req.file.originalname));
    const doc = await Trilha.create({
      nome,
      arquivo: `${PASTA}/${req.file.filename}`,
      tamanho: req.file.size || 0,
    });
    res.status(201).json({ _id: doc._id, nome: doc.nome, tamanho: doc.tamanho, createdAt: doc.createdAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Trilha.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Trilha não encontrada' });
    /* O arquivo vai junto — sem isto o disco encheria de trilhas órfãs. Falha
       em apagar o arquivo não desfaz a remoção do registro: o que a pessoa
       pediu foi tirar a trilha da lista, e isso já aconteceu. */
    try { fs.unlinkSync(path.join(RAIZ_UPLOADS, doc.arquivo)); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
