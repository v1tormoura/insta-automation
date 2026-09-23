const Legend = require('../models/Legend');

exports.createLegend = async (req, res) => {
  try {
    const legend = await Legend.create({
      title: req.body.title,
      category: req.body.category || 'Geral',
      text: req.body.text,
      isActive: req.body.isActive !== false,
    });

    res.json(legend);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLegends = async (req, res) => {
  try {
    /* Favoritas primeiro, depois as mais novas: é a ordem em que se procura
       uma legenda — a que se usa sempre, e o que foi escrito por último. */
    const legends = await Legend.find().sort({ favorita: -1, createdAt: -1 });
    res.json(legends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Atualiza SÓ o que veio no corpo.
 *
 * Era um `findByIdAndUpdate` com os quatro campos sempre: um PATCH mandando
 * apenas `{ favorita: true }` gravava `title: undefined` e `text: undefined`
 * por cima — favoritar apagaria a legenda. O defeito não aparecia porque a
 * única tela que chamava o PATCH mandava o formulário inteiro.
 */
exports.updateLegend = async (req, res) => {
  try {
    const campos = {};
    if (typeof req.body.title === 'string')    campos.title    = req.body.title;
    if (typeof req.body.category === 'string') campos.category = req.body.category || 'Geral';
    if (typeof req.body.text === 'string')     campos.text     = req.body.text;
    if (typeof req.body.isActive === 'boolean') campos.isActive = req.body.isActive;
    if (typeof req.body.favorita === 'boolean') campos.favorita = req.body.favorita;

    if (!Object.keys(campos).length) {
      return res.status(400).json({ error: 'Nada para atualizar', code: 'CORPO_VAZIO' });
    }

    const legend = await Legend.findByIdAndUpdate(req.params.id, { $set: campos }, { new: true });
    if (!legend) return res.status(404).json({ error: 'Legenda não encontrada' });

    res.json(legend);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteLegend = async (req, res) => {
  try {
    await Legend.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getRandomLegend = async (req, res) => {
  try {
    const filter = {
      isActive: true,
    };

    if (req.query.category) {
      filter.category = req.query.category;
    }

    const count = await Legend.countDocuments(filter);

    if (!count) {
      return res.status(404).json({ error: 'Nenhuma legenda encontrada' });
    }

    const random = Math.floor(Math.random() * count);

    const legend = await Legend.findOne(filter).skip(random);

    res.json(legend);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
