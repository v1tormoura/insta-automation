'use strict';

/** Biblioteca de trilhas de áudio que o Postar usa para trocar ou misturar o som dos vídeos. */

const path = require('path');
const fs = require('fs');
const router = require('express').Router();
const multer = require('multer');
const { trilhas } = require('../repos');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');
const PASTA = 'trilhas';
const EXT_AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(RAIZ_UPLOADS, PASTA);
      fs.mkdir(dir, { recursive: true }, err => cb(err, dir));
    },
    filename: (_req, file, cb) => {
      cb(null, `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${path.extname(file.originalname) || '.mp3'}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // A extensão também vale: o navegador manda `video/ogg` para .ogg.
    const ok = String(file.mimetype || '').startsWith('audio/') || EXT_AUDIO.test(path.extname(file.originalname || ''));
    cb(ok ? null : new Error('Apenas arquivos de áudio são permitidos'), ok);
  },
});

const resumo = t => ({ id: t.id, nome: t.nome, tamanho: t.tamanho, createdAt: t.createdAt });

router.get('/', async (req, res) => {
  res.json((await trilhas.de(req.user.id).findMany()).map(resumo));
});

router.post('/', (req, res, next) => upload.single('file')(req, res, async err => {
  if (err) return res.status(400).json({ error: err.message || 'Falha no envio do áudio' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const nome = String(req.body?.nome || '').trim() || path.basename(req.file.originalname, path.extname(req.file.originalname));
    const trilha = await trilhas.de(req.user.id).insert({ nome, arquivo: `${PASTA}/${req.file.filename}`, tamanho: req.file.size || 0 });
    res.status(201).json(resumo(trilha));
  } catch (e) {
    next(e);
  }
}));

router.delete('/:id', async (req, res) => {
  const trilha = await trilhas.de(req.user.id).remove(req.params.id);
  if (!trilha) return res.status(404).json({ error: 'Trilha não encontrada' });
  // O arquivo vai junto; falhar ao apagá-lo não desfaz a remoção do registro.
  fs.rm(path.join(RAIZ_UPLOADS, trilha.arquivo), { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = router;
