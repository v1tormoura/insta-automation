'use strict';
const router   = require('express').Router();
const MetaApp  = require('../models/MetaApp');
const { encrypt } = require('../services/tokenEncryption');

// GET /meta-apps — lista todos
router.get('/', async (req, res) => {
  try {
    const apps = await MetaApp.find().sort({ isDefault: -1, createdAt: 1 }).lean();
    // nunca expõe secrets em claro: mascara
    const safe = apps.map(a => ({
      ...a,
      appSecret:          mask(a.appSecret),
      instagramAppSecret: mask(a.instagramAppSecret),
    }));
    res.json(safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /meta-apps — cria novo
router.post('/', async (req, res) => {
  try {
    const { name, appId, appSecret, loginConfigId, instagramAppId, instagramAppSecret } = req.body;
    if (!name?.trim())      return res.status(400).json({ error: 'Nome obrigatório' });
    if (!appId?.trim())     return res.status(400).json({ error: 'App ID obrigatório' });
    if (!appSecret?.trim()) return res.status(400).json({ error: 'App Secret obrigatório' });

    const count = await MetaApp.countDocuments();
    const app = await MetaApp.create({
      name: name.trim(), appId: appId.trim(),
      // Cifrado em repouso (AES-256-GCM). Sem ENCRYPTION_KEY, encrypt() é no-op
      // e guarda em texto puro — mesmo comportamento de antes.
      appSecret:          encrypt(appSecret.trim()),
      loginConfigId:      (loginConfigId || '').trim(),
      instagramAppId:     (instagramAppId || '').trim(),
      instagramAppSecret: encrypt((instagramAppSecret || '').trim()),
      isDefault: count === 0, // primeiro app criado vira padrão automaticamente
    });
    res.status(201).json({ ...app.toObject(), appSecret: mask(app.appSecret), instagramAppSecret: mask(app.instagramAppSecret) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /meta-apps/:id — atualiza campos (secret vazio = não altera)
router.patch('/:id', async (req, res) => {
  try {
    const doc = await MetaApp.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'App não encontrado' });

    const { name, appId, appSecret, loginConfigId, instagramAppId, instagramAppSecret } = req.body;
    if (name !== undefined)               doc.name               = name.trim();
    if (appId !== undefined)              doc.appId              = appId.trim();
    if (appSecret?.trim())                doc.appSecret          = encrypt(appSecret.trim());
    if (loginConfigId !== undefined)      doc.loginConfigId      = loginConfigId.trim();
    if (instagramAppId !== undefined)     doc.instagramAppId     = instagramAppId.trim();
    if (instagramAppSecret?.trim())       doc.instagramAppSecret = encrypt(instagramAppSecret.trim());
    await doc.save();
    res.json({ ...doc.toObject(), appSecret: mask(doc.appSecret), instagramAppSecret: mask(doc.instagramAppSecret) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /meta-apps/:id/set-default — marca como padrão
router.post('/:id/set-default', async (req, res) => {
  try {
    await MetaApp.updateMany({}, { isDefault: false });
    const doc = await MetaApp.findByIdAndUpdate(req.params.id, { isDefault: true }, { new: true });
    if (!doc) return res.status(404).json({ error: 'App não encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /meta-apps/:id
router.delete('/:id', async (req, res) => {
  try {
    const doc = await MetaApp.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'App não encontrado' });
    // se era o padrão, promove o mais antigo
    if (doc.isDefault) {
      const next = await MetaApp.findOne().sort({ createdAt: 1 });
      if (next) await MetaApp.findByIdAndUpdate(next._id, { isDefault: true });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Nunca devolve o segredo — nem um pedaço dele. O valor guardado está cifrado
   (`enc1:…`), então fatiá-lo mostraria só ciphertext; e o front não exibe o
   segredo em lugar nenhum. Um indicador fixo diz apenas "existe um segredo". */
function mask(s) {
  return s ? '••••••••' : '';
}

module.exports = router;
