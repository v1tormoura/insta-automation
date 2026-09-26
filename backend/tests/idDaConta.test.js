'use strict';

/**
 * O id com que se publica é o da conta PROFISSIONAL (`user_id` do /me), não o
 * da pessoa no app (o `user_id` da troca do código). Com o segundo, a Meta
 * recusa /{id}/media com "Object with ID ... does not exist, cannot be loaded
 * due to missing permissions".
 *
 *   conexão nova        → grava o id do /me
 *   reconexão           → acha a conta gravada com o id antigo, sem duplicar
 *   conta já gravada    → a sincronização e a publicação corrigem sozinhas
 */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';

const banco = require('./helpers/banco');
const { sql } = banco;
const graph = require('../src/services/instagramAPI');
const metaApps = require('../src/repos/metaApps');
const accounts = require('../src/repos/accounts');

const ID_DO_APP = '28728200203462880';
const ID_PROFISSIONAL = '17841400000000001';

const perfil = { igUserId: ID_PROFISSIONAL, username: 'tatiane', name: 'Tatiane', accountType: 'business', avatarUrl: '', followers: null, following: null, postsCount: null };

beforeEach(async () => {
  await banco.limpar();
  jest.restoreAllMocks();
  jest.spyOn(graph, 'perfil').mockResolvedValue(perfil);
});
afterAll(() => sql.end());

function conectar(alvo = 'new') {
  jest.spyOn(metaApps, 'credenciais').mockResolvedValue({ id: null, appId: '1', appSecret: 's' });
  jest.spyOn(graph, 'trocarCodigo').mockResolvedValue({ token: 'curto', userId: ID_DO_APP });
  jest.spyOn(graph, 'tokenDeLongaDuracao').mockResolvedValue({ token: 'longo', expiraEm: new Date(Date.now() + 86_400_000) });
  return require('../src/services/conexao').conectarPorCodigo('codigo', { alvo, metaAppId: null, usuarioId: banco.DONO_ID });
}

test('conexão grava o id da conta profissional, não o do app', async () => {
  const conta = await conectar();
  expect(conta.igUserId).toBe(ID_PROFISSIONAL);
});

test('reconectar uma conta gravada com o id do app atualiza a mesma linha', async () => {
  const antiga = await accounts.de(banco.DONO_ID).insert({ username: 'tatiane', accessToken: 'velho', igUserId: ID_DO_APP });
  const conta = await conectar();
  expect(conta.id).toBe(antiga.id);
  expect((await sql`select ig_user_id from accounts`).map(r => r.igUserId)).toEqual([ID_PROFISSIONAL]);
});

test('a sincronização troca o id do app pelo profissional', async () => {
  const c = await accounts.de(banco.DONO_ID).insert({ username: 'tatiane', accessToken: 'tok', igUserId: ID_DO_APP });
  await require('../src/services/contas').sincronizar(await accounts.findById(c.id));
  expect((await accounts.findById(c.id)).igUserId).toBe(ID_PROFISSIONAL);
});

test('a publicação confere o id antes de chamar /{id}/media', async () => {
  const c = await accounts.de(banco.DONO_ID).insert({ username: 'tatiane', accessToken: 'tok', igUserId: ID_DO_APP });
  const conta = await accounts.findById(c.id);
  await require('../src/services/publicar')._conferirId(conta);
  expect(conta.igUserId).toBe(ID_PROFISSIONAL);
  expect((await accounts.findById(c.id)).igUserId).toBe(ID_PROFISSIONAL);
});
