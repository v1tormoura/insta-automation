const fs = require('fs');
const path = require('path');
const Account = require('../models/Account');
const syncAccountInfo = require('../services/syncAccountInfo');
const openAccountBrowser = require('../services/openAccountBrowser');

function getSessionPath(username) {
  return path.resolve(__dirname, '../../sessions', username, 'cookies.json');
}

exports.getSessions = async (req, res) => {
  try {
    const accounts = await Account.find().sort({ updatedAt: -1 });

    const sessions = accounts.map((account) => {
      const hasSession = fs.existsSync(getSessionPath(account.username));

      let sessionStatus = 'ok';

      if (!hasSession) sessionStatus = 'sem_sessao';
      if (account.healthStatus === 'sessao_expirada') sessionStatus = 'expirada';
      if (account.healthStatus === 'erro_login') sessionStatus = 'erro_login';
      if (account.isBusy) sessionStatus = 'em_uso';

      return {
        _id: account._id,
        username: account.username,
        name: account.name,
        avatar: account.avatar,
        healthStatus: account.healthStatus,
        lastError: account.lastError,
        lastSync: account.lastSync,
        isBusy: account.isBusy,
        busyReason: account.busyReason,
        hasSession,
        sessionStatus,
      };
    });

    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.testSession = async (req, res) => {
  try {
    const account = await syncAccountInfo(req.params.id);
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.openSession = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Abrindo sessão...',
    });

    openAccountBrowser(req.params.id).catch((err) => {
      console.log('Erro ao abrir sessão:', err.message);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
