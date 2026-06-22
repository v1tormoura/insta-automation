const Account = require('../models/Account');

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0); // próxima meia-noite
  return midnight.getTime() - now.getTime();
}

async function resetPostsToday() {
  try {
    const result = await Account.updateMany(
      { postsToday: { $gt: 0 } },
      { $set: { postsToday: 0, lastPostDate: null } }
    );
    console.log(`🔄 Reset diário: ${result.modifiedCount} contas zeradas`);
  } catch (err) {
    console.log('💥 Erro no reset diário de postsToday:', err.message);
  }
}

function startDailyReset() {
  const delay = msUntilMidnight();
  const hours = Math.round(delay / 1000 / 60 / 60 * 10) / 10;

  console.log(`⏰ Reset diário agendado em ${hours}h`);

  setTimeout(() => {
    resetPostsToday();
    // Repetir a cada 24h
    setInterval(resetPostsToday, 24 * 60 * 60 * 1000);
  }, delay);
}

module.exports = startDailyReset;
