'use strict';

/**
 * Saúde das contas: uma nota de 0 a 100 por conta, a partir do que o sync da
 * API oficial já registrou (estado, erro, token, última sincronização).
 */

const router = require('express').Router();
const accounts = require('../repos/accounts');
const contas = require('../services/contas');

const horasDesde = d => (d ? (Date.now() - new Date(d).getTime()) / 3_600_000 : null);
const diasAte = d => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);

function nota(c) {
  if (c.healthStatus === 'banida') return 0;
  let score = 100;
  if (!(c.accessToken && c.igUserId)) score -= 35;
  if (c.healthStatus === 'restrita' || c.healthStatus === 'conta_pessoal') score -= 30;
  if (c.healthStatus === 'token_invalido') score -= 60;
  if (c.lastError) score -= 15;
  if (c.isBusy && c.busySince) score -= horasDesde(c.busySince) > 0.5 ? 20 : 5;
  const sync = horasDesde(c.lastSync);
  if (sync === null) score -= 20;
  else if (sync > 72) score -= 20;
  else if (sync > 48) score -= 10;
  const dias = diasAte(c.tokenExpiresAt);
  if (c.healthStatus !== 'token_invalido' && dias !== null) {
    if (dias < 0) score -= 60;
    else if (dias < 7) score -= 15;
  }
  return Math.max(0, score);
}

function nivel(score, c) {
  if (c.healthStatus === 'banida') return 'banida';
  if (c.healthStatus === 'token_invalido') return 'risco';
  if (score >= 75) return 'saudavel';
  if (score >= 45) return 'atencao';
  return 'risco';
}

router.get('/', async (_req, res) => {
  const lista = await accounts.findMany({}, { orderBy: 'updated_at desc' });
  const linhas = lista.map(c => {
    const score = nota(c);
    const sync = horasDesde(c.lastSync);
    return {
      id: c.id,
      username: c.username,
      name: c.name,
      avatar: c.avatar,
      accountType: c.accountType || null,
      healthStatus: c.healthStatus,
      status: c.status,
      score,
      level: nivel(score, c),
      hasApiToken: !!(c.accessToken && c.igUserId),
      postsToday: c.postsToday || 0,
      dailyPostLimit: c.dailyPostLimit || 0,
      lastPostAt: c.lastPostAt,
      lastSync: c.lastSync,
      syncAgeHours: sync !== null ? Math.round(sync) : null,
      lastError: c.lastError,
      isBusy: c.isBusy,
      busyReason: c.busyReason,
      tokenDaysLeft: diasAte(c.tokenExpiresAt),
    };
  });
  res.json({
    summary: {
      total: linhas.length,
      saudavel: linhas.filter(r => r.level === 'saudavel').length,
      atencao: linhas.filter(r => r.level === 'atencao').length,
      risco: linhas.filter(r => r.level === 'risco').length,
      banida: linhas.filter(r => r.level === 'banida').length,
      semToken: linhas.filter(r => !r.hasApiToken).length,
    },
    accounts: linhas,
  });
});

/** "Verificar agora": sincroniza todas em segundo plano. */
router.post('/check-now', (_req, res) => {
  contas.sincronizarTodas().catch(e => console.log('[Saúde] verificação falhou:', e.message));
  res.json({ success: true, message: 'Verificação iniciada em segundo plano.' });
});

module.exports = router;
