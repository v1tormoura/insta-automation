'use strict';

const ApiLog = require('../models/ApiLog');

/**
 * Logs an API call. Never throws — logging failures must not affect the main flow.
 * Does not log token values, passwords, or other sensitive data.
 */
async function logApiCall({ accountId, endpoint, method = 'GET', statusCode = 200, success = true, errorCode = null, durationMs = 0 }) {
  try {
    await ApiLog.create({ accountId, endpoint, method, statusCode, success, errorCode, durationMs });
  } catch { /* silently ignore */ }
}

function logApiCallAsync(params) {
  logApiCall(params).catch(() => {});
}

module.exports = { logApiCall, logApiCallAsync };
