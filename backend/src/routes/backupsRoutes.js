'use strict';

/**
 * Backups (só admin): o status do último ./backup.sh e os arquivos guardados
 * na VPS, para baixar — um backup que só existe dentro da VPS não protege se
 * a VPS for perdida.
 *
 *   GET /backups              { ultimo, arquivos[] }
 *   GET /backups/:arquivo     download (aceita ?token=, aberto pelo navegador)
 */

const fs = require('fs');
const path = require('path');
const router = require('express').Router();

const PASTA = process.env.BACKUP_DIR || path.resolve(__dirname, '../../backups');
const NOME_VALIDO = /^(banco|midias)-\d{4}-\d{2}-\d{2}_\d{4}\.(sql\.gz|tgz)$/;

function lerUltimo() {
  try { return JSON.parse(fs.readFileSync(path.join(PASTA, 'ultimo.json'), 'utf8')); } catch { return null; }
}

function listar() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA); } catch { return []; }
  return nomes.filter(n => NOME_VALIDO.test(n)).map(n => {
    const st = fs.statSync(path.join(PASTA, n));
    return { arquivo: n, tipo: n.startsWith('banco') ? 'banco' : 'midias', bytes: st.size, quando: st.mtime };
  }).sort((a, b) => b.quando - a.quando);
}

router.get('/', (req, res) => {
  res.json({ ultimo: lerUltimo(), arquivos: listar(), pastaMontada: fs.existsSync(PASTA) });
});

router.get('/:arquivo', (req, res) => {
  const nome = String(req.params.arquivo || '');
  if (!NOME_VALIDO.test(nome)) return res.status(400).json({ error: 'Arquivo inválido' });
  const alvo = path.join(PASTA, nome);
  if (!fs.existsSync(alvo)) return res.status(404).json({ error: 'Backup não encontrado' });
  res.download(alvo, nome);
});

module.exports = { router, lerUltimo, listar, PASTA };
