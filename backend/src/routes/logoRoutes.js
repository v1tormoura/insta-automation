'use strict';

/**
 *   GET    /conta/logo   { arquivo, url } — ou nulos
 *   POST   /conta/logo   multipart "logo" (PNG, JPG ou WEBP até 3 MB)
 *   DELETE /conta/logo
 */

const router = require('express').Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const logo = require('../services/logoDoUsuario');
const { tipoPeloConteudo } = require('../services/preparoDeMidia');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const resposta = rel => ({ arquivo: rel || null, url: rel ? `/uploads/${rel}` : null });

router.get('/', async (req, res) => {
  res.json(resposta(await logo.ler(req.user.id)));
});

router.post('/', (req, res) => {
  upload.single('logo')(req, res, async err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'O logo pode ter até 3 MB.' : 'Envio inválido.' });
    const buf = req.file?.buffer;
    if (!buf) return res.status(400).json({ error: 'Escolha uma imagem.' });
    if (tipoPeloConteudo(buf.subarray(0, 64))?.tipo !== 'imagem') return res.status(422).json({ error: 'Use PNG, JPG ou WEBP.' });
    const tmp = path.join(os.tmpdir(), `logo-${crypto.randomUUID()}`);
    fs.writeFileSync(tmp, buf);
    try {
      res.json(resposta(await logo.salvar(req.user.id, tmp)));
    } catch (e) {
      res.status(e.invalido ? 422 : 500).json({ error: e.invalido ? e.message : 'Não foi possível salvar o logo.' });
    } finally { fs.rmSync(tmp, { force: true }); }
  });
});

router.delete('/', async (req, res) => {
  await logo.remover(req.user.id);
  res.json(resposta(null));
});

module.exports = router;
