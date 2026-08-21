const fs = require('fs');
const path = require('path');
const Media = require('../models/Media');

function getMediaType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'other';
}

// GET /media?folder=X&search=&type=&limit=&skip=
//
// Filtro e paginação existem porque a biblioteca cresce indefinidamente: sem
// eles, toda tela que lista mídia (o wizard de campanha inclusive) baixava o
// acervo inteiro e o usuário tinha de caçar o arquivo no meio de centenas.
// Os parâmetros são opcionais — sem nenhum, o comportamento antigo continua.
exports.getMedia = async (req, res) => {
  try {
    const query = {};
    if (req.query.folder) query.folder = req.query.folder;

    // 'video' | 'image' | 'other'
    if (['image', 'video', 'other'].includes(req.query.type)) query.type = req.query.type;

    const busca = String(req.query.search || '').trim();
    if (busca) {
      // Escapa a entrada: um '(' digitado na busca quebraria a regex inteira.
      const seguro = busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(seguro, 'i');
      query.$or = [{ originalName: re }, { filename: re }];
    }

    const limite = Math.min(500, Math.max(0, Number(req.query.limit) || 0));
    const pular  = Math.max(0, Number(req.query.skip) || 0);

    let consulta = Media.find(query).sort({ createdAt: -1 }).skip(pular);
    if (limite) consulta = consulta.limit(limite);

    const [media, total] = await Promise.all([
      consulta,
      limite || pular || busca ? Media.countDocuments(query) : null,
    ]);

    // derive unique folder list
    const allMedia = await Media.find({}, 'folder').lean();
    const folders = [...new Set(allMedia.map(m => m.folder || 'default'))].sort();

    res.json({ files: media, folders, total: total ?? media.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /media/upload  (body: folder)
exports.uploadMedia = async (req, res) => {
  try {
    // Aceita qualquer nome de campo. O filtro antigo só deixava passar 'media',
    // então quem enviasse com outro nome (o wizard de campanha manda 'files')
    // recebia 200 com zero mídias criadas — upload que "não funciona" sem erro.
    const files = req.files || [];
    const folder = req.body.folder || 'default';
    const created = [];
    for (const file of files) {
      const media = await Media.create({
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        url: `/uploads/${file.filename}`,
        mimeType: file.mimetype,
        size: file.size,
        type: getMediaType(file.mimetype),
        folder,
      });
      created.push(media);
    }
    // `files` é alias de `media`: as duas telas que consomem esta rota leem
    // chaves diferentes, e devolver as duas evita quebrar qualquer uma.
    res.json({ success: true, total: created.length, media: created, files: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /media/:id
exports.deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Mídia não encontrada' });
    const filePath = path.resolve(media.path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await Media.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /media/:id/folder
exports.moveMedia = async (req, res) => {
  try {
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ error: 'folder obrigatório' });
    const media = await Media.findByIdAndUpdate(req.params.id, { folder }, { new: true });
    if (!media) return res.status(404).json({ error: 'Mídia não encontrada' });
    res.json(media);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /media/folder  — cria uma pasta vazia (media fictícia de marcador)
// Na verdade só retornamos a lista atualizada após garantir existência
exports.createFolder = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const folderName = name.trim().toLowerCase().replace(/[^a-z0-9_\-\s]/g, '').trim();
    if (!folderName) return res.status(400).json({ error: 'Nome inválido' });
    // Pasta é representada só pelo campo folder nas mídias;
    // Para pastas vazias, guardamos um marcador invisível
    const exists = await Media.findOne({ folder: folderName });
    if (!exists) {
      // cria placeholder para registrar pasta
      await Media.create({
        filename: `__folder_${folderName}__`,
        originalName: `__folder_${folderName}__`,
        path: '',
        url: '',
        mimeType: '',
        size: 0,
        type: 'other',
        folder: folderName,
        _isPlaceholder: true,
      });
    }
    res.json({ success: true, folder: folderName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /media/folder/:name
exports.deleteFolder = async (req, res) => {
  try {
    const folderName = req.params.name;
    if (folderName === 'default') return res.status(400).json({ error: 'Pasta default não pode ser excluída' });
    // move mídias para default
    await Media.updateMany({ folder: folderName }, { folder: 'default' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
