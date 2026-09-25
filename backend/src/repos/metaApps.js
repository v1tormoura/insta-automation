'use strict';

/**
 * Apps da Meta usados para conectar contas. Os segredos ficam cifrados em
 * repouso e nunca saem em resposta da API — nem mascarados pela metade.
 */

const { sql, tabela } = require('../db');
const { encrypt, decrypt } = require('../services/tokenEncryption');

const base = tabela('meta_apps');
const MASCARA = '••••••••';

function paraApi(app) {
  if (!app) return app;
  return {
    ...app,
    appSecret: app.appSecret ? MASCARA : '',
    instagramAppSecret: app.instagramAppSecret ? MASCARA : '',
  };
}

async function listar() {
  const apps = await sql`select * from meta_apps order by is_default desc, created_at`;
  /* Quantas contas cada app carrega — reputação de app é real: quando várias
     contas de um app caem, as outras daquele app sentem. */
  const porApp = await sql`
    select meta_app_id,
           count(*) as contas,
           count(*) filter (where health_status <> 'ativa') as com_problema
    from accounts where meta_app_id is not null group by meta_app_id`;
  const mapa = new Map(porApp.map(p => [p.metaAppId, p]));
  return apps.map(a => ({ ...paraApi(a), contas: mapa.get(a.id)?.contas || 0, comProblema: mapa.get(a.id)?.comProblema || 0 }));
}

async function criar({ name, appId, appSecret, loginConfigId = '', instagramAppId = '', instagramAppSecret = '' }) {
  const [{ n }] = await sql`select count(*) as n from meta_apps`;
  return paraApi(await base.insert({
    name, appId, loginConfigId, instagramAppId,
    appSecret: encrypt(appSecret),
    instagramAppSecret: instagramAppSecret ? encrypt(instagramAppSecret) : '',
    isDefault: n === 0, // o primeiro app cadastrado vira o padrão
  }));
}

async function atualizar(id, campos) {
  const patch = { ...campos };
  // Segredo vazio = não alterar.
  if (patch.appSecret) patch.appSecret = encrypt(patch.appSecret); else delete patch.appSecret;
  if (patch.instagramAppSecret) patch.instagramAppSecret = encrypt(patch.instagramAppSecret); else delete patch.instagramAppSecret;
  return paraApi(await base.update(id, patch));
}

async function definirPadrao(id) {
  return sql.begin(async tx => {
    const app = await base.findById(id, tx);
    if (!app) return false;
    await tx`update meta_apps set is_default = (id = ${id})`;
    return true;
  });
}

async function remover(id) {
  return sql.begin(async tx => {
    const app = await base.remove(id, tx);
    if (app?.isDefault) {
      await tx`update meta_apps set is_default = true where id = (select id from meta_apps order by created_at limit 1)`;
    }
    return app;
  });
}

/**
 * Credenciais para o OAuth: do app pedido ou do padrão. Se o app tem um
 * sub-app Instagram, id e segredo saem dele (os dois do MESMO sub-app).
 * @returns {Promise<{id: string, appId: string, appSecret: string, loginConfigId: string}|null>}
 */
async function credenciais(metaAppId = null) {
  const app = metaAppId ? await base.findById(metaAppId) : await base.findOne({ isDefault: true });
  if (!app) return null;
  const usaIg = !!(app.instagramAppId && app.instagramAppSecret);
  return {
    id: app.id,
    appId: usaIg ? app.instagramAppId : app.appId,
    appSecret: decrypt(usaIg ? app.instagramAppSecret : app.appSecret),
    loginConfigId: app.loginConfigId || '',
  };
}

module.exports = { listar, criar, atualizar, definirPadrao, remover, credenciais, findById: base.findById };
