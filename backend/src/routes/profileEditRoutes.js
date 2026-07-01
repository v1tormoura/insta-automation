'use strict';

const router  = require('express').Router();
const multer  = require('multer');
const Account = require('../models/Account');
const { editProfile, bulkEditProfiles } = require('../services/profileEditService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Jobs em andamento: jobId → { status, startedAt, results, error }
const _jobs = new Map();
let _jobSeq = 1;

function newJobId() { return `pedit_${_jobSeq++}`; }

// ── POST /profile-edit/bulk ───────────────────────────────────────────────────
router.post('/bulk', upload.single('photo'), async (req, res) => {
  let edits;
  try {
    edits = typeof req.body.edits === 'string' ? JSON.parse(req.body.edits) : req.body.edits;
  } catch {
    return res.status(400).json({ error: 'Campo "edits" inválido' });
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    return res.status(400).json({ error: 'Campo "edits" deve ser um array não-vazio' });
  }

  const delayBetween = Number(req.body.delayBetween) || 5000;

  // Attach uploaded photo buffer to each edit
  const photoBuffer = req.file ? req.file.buffer : null;
  const enrichedEdits = edits.map(e => ({ ...e, profilePicBuffer: photoBuffer || undefined }));

  const jobId = newJobId();
  _jobs.set(jobId, { status: 'running', startedAt: new Date(), results: [], total: edits.length });

  bulkEditProfiles(enrichedEdits, { delayBetween })
    .then(results => {
      _jobs.set(jobId, { status: 'done', startedAt: _jobs.get(jobId).startedAt, finishedAt: new Date(), results, total: edits.length });
    })
    .catch(err => {
      _jobs.set(jobId, { ..._jobs.get(jobId), status: 'error', error: err.message });
    });

  res.json({ jobId, status: 'running', total: edits.length, message: 'Job iniciado em background' });
});

// ── GET /profile-edit/job/:jobId ──────────────────────────────────────────────
router.get('/job/:jobId', (req, res) => {
  const job = _jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json(job);
});

// ── GET /profile-edit/jobs ────────────────────────────────────────────────────
router.get('/jobs', (req, res) => {
  const jobs = [];
  for (const [id, job] of _jobs) jobs.push({ jobId: id, ...job });
  res.json(jobs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)));
});

// ── POST /profile-edit/:id ────────────────────────────────────────────────────
router.post('/:id', upload.single('photo'), async (req, res) => {
  const account = await Account.findById(req.params.id).catch(() => null);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  if (!account.igSession && !account.password) {
    return res.status(400).json({ error: 'Conta sem sessão ou senha — Private API indisponível' });
  }

  const body = {
    fullName:        req.body.fullName,
    biography:       req.body.biography,
    gender:          req.body.gender !== undefined ? Number(req.body.gender) : undefined,
    profilePicUrl:   req.body.profilePicUrl,
    profilePicBuffer: req.file ? req.file.buffer : undefined,
    customGender:    req.body.customGender,
  };

  try {
    const result = await editProfile(account, body);
    res.json({ username: account.username, status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
