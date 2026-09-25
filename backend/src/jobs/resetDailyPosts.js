'use strict';

/** Zera `posts_today` das contas à meia-noite (fuso do processo). */

const { sql } = require('../db');

function msAteMeiaNoite() {
  const meiaNoite = new Date();
  meiaNoite.setHours(24, 0, 0, 0);
  return meiaNoite.getTime() - Date.now();
}

async function zerar() {
  try {
    const r = await sql`update accounts set posts_today = 0, last_post_date = null where posts_today > 0`;
    if (r.count) console.log(`🔄 Reset diário: ${r.count} conta(s) zerada(s)`);
  } catch (err) {
    console.log('💥 Erro no reset diário de postsToday:', err.message);
  }
}

function startDailyReset() {
  setTimeout(() => {
    zerar();
    setInterval(zerar, 24 * 60 * 60 * 1000);
  }, msAteMeiaNoite());
}

module.exports = startDailyReset;
