const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function writeAccountLog(username, message) {
  try {
    const file = path.join(LOGS_DIR, `${username}.log`);

    const date = new Date().toLocaleString('pt-BR');

    fs.appendFileSync(file, `[${date}] ${message}\n`);
  } catch (err) {
    console.log('Erro ao gravar log:', err.message);
  }
}

module.exports = {
  writeAccountLog,
};
