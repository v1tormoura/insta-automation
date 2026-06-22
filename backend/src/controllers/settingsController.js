const fs = require('fs');
const path = require('path');

const settingsPath = path.resolve(__dirname, '../../data/settings.json');

function ensureSettingsFile() {
  const dir = path.dirname(settingsPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          headless: process.env.HEADLESS === 'true',
        },
        null,
        2
      )
    );
  }
}

exports.getSettings = async (req, res) => {
  try {
    ensureSettingsFile();

    const settings = JSON.parse(fs.readFileSync(settingsPath));

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    ensureSettingsFile();

    const current = JSON.parse(fs.readFileSync(settingsPath));

    const updated = {
      ...current,
      headless: !!req.body.headless,
    };

    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));

    process.env.HEADLESS = updated.headless ? 'true' : 'false';

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
