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
    const legends = await Legend.find().sort({ createdAt: -1 });
    res.json(legends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLegend = async (req, res) => {
  try {
    const legend = await Legend.findByIdAndUpdate(
      req.params.id,
      {
        title: req.body.title,
        category: req.body.category || 'Geral',
        text: req.body.text,
        isActive: req.body.isActive,
      },
      { new: true }
    );

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
