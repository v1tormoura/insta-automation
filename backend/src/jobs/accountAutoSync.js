'use strict';

// AutoSync — usa apenas APIs (sem Puppeteer, sem browser)
// Ordem de prioridade por conta:
//   1. Graph API  — contas com token OAuth (IGQ/EAA)
//   2. Private API — contas com igSession ou cookies.json (accountFastSync)
//   3. Só atualiza lastSync — sem credenciais válidas

const Account       = require('../models/Account');
const syncViaAPI    = require('../services/syncAccountAPI');
const { syncOneAccountFast } = require('./accountFastSync');
const { broadcast } = require('../events/broadcaster');
const ritmo         = require('../services/ritmoDeSincronizacao');

const delay = ms => new Promise(r => setTimeout(r, ms));

let running = false;

async function runAutoSync() {
  if (running) return;
  running = true;

  try {
    const accounts = await Account.find({
      status: { $ne: 'banida' },
      isBusy: { $ne: true },
    }).sort({ lastSync: 1 });   // a mais antiga primeiro — ver ritmoDeSincronizacao.js

    /* ── Conta da API oficial não entra no rodízio ──────────────────────────

       O rodízio (fatia + silêncio noturno) de `ritmoDeSincronizacao` existe por
       um motivo específico: consultar o perfil pela API PRIVADA a cada poucos
       minutos, a noite toda, é um padrão que nenhum celular produz — e igual
       entre as contas, denuncia que são a mesma mão.

       Isso não vale para quem tem token do Graph. Ali a chamada é
       servidor-a-servidor, pelo endereço público da Meta, autenticada por um
       token que ela mesma emitiu: é exatamente o tráfego que a plataforma
       espera, e o limite por token é folgado (uma leitura a cada 5 min dá 12/h,
       muito abaixo do teto). Prender essas contas ao rodízio só fazia o painel
       mostrar seguidores e publicações defasados em até 30 minutos, sem ganho
       nenhum de segurança.

       Então: oficiais em todo tique; as de sessão seguem no rodízio. */
    const ehOficial = c => !!(c.accessToken && c.igUserId);
    const oficiais  = accounts.filter(ehOficial);
    const deSessao  = accounts.filter(c => !ehOficial(c));

    const daVez = [...oficiais, ...ritmo.fatiaDaVez(deSessao)];
    if (!daVez.length) {
      if (accounts.length) console.log(`⏸️  AutoSync — ${ritmo.emSilencio() ? 'silêncio noturno' : 'nada na vez'}`);
      return;
    }
    console.log(`🔄 AutoSync — ${daVez.length} de ${accounts.length} conta(s) (${oficiais.length} oficial(is) em todo tique)`);

    for (const acc of daVez) {
      const fresh = await Account.findById(acc._id);
      if (!fresh || fresh.isBusy) continue;

      try {
        if (fresh.accessToken && fresh.igUserId) {
          // Conta com token OAuth — Graph API (sem browser)
          await syncViaAPI(fresh);
          await delay(1500);
        } else {
          // Conta sem token — tenta private API (igSession / cookies.json)
          // syncOneAccountFast ignora silenciosamente se não tiver sessão
          await syncOneAccountFast(fresh);
          await delay(3000);
        }
      } catch (err) {
        console.log(`⚠️ Sync @${acc.username}: ${err.message}`);
        await delay(2000);
      }
    }

    broadcast('accounts', { action: 'synced' });
    console.log('✅ AutoSync concluído');
  } catch (err) {
    console.log('💥 Erro AutoSync:', err.message);
  } finally {
    running = false;
  }
}

function startAutoSync() {
  // Primeira execução: 30s após iniciar
  setTimeout(runAutoSync, 30_000);

  // Depois: a cada 5 minutos
  setInterval(runAutoSync, 5 * 60 * 1000);
}

module.exports = startAutoSync;
