const fs = require('fs');
const path = require('path');

exports.getAccountLogs = async (req, res) => {
  try {
    const username = req.params.username;

    const file = path.resolve(__dirname, '../../logs', `${username}.log`);

    if (!fs.existsSync(file)) {
      return res.json([]);
    }

    const content = fs.readFileSync(file, 'utf8');

    const lines = content.split('\n').filter(Boolean).reverse().slice(0, 50);

    res.json(lines);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};
