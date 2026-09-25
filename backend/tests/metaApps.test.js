'use strict';

/**
 * O App Meta: segredo cifrado em repouso, nunca devolvido pela API, e o par
 * id × segredo sempre do MESMO app (misturar faz a Meta recusar a troca).
 */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';

const banco = require('./helpers/banco');
const metaApps = require('../src/repos/metaApps');

beforeEach(() => banco.limpar());

test('o App Secret é gravado cifrado e volta em claro só para o OAuth', async () => {
  const app = await metaApps.criar({ name: 'A', appId: '111', appSecret: 'segredo-a' });
  const [linha] = await banco.sql`select app_secret from meta_apps where id = ${app.id}`;
  expect(linha.appSecret).toMatch(/^enc1:/);
  expect(linha.appSecret).not.toContain('segredo-a');
  expect((await metaApps.credenciais(app.id)).appSecret).toBe('segredo-a');
});

test('a API nunca devolve o segredo — nem um pedaço', async () => {
  const criado = await metaApps.criar({ name: 'A', appId: '111', appSecret: 'segredo-a', instagramAppId: '222', instagramAppSecret: 'segredo-ig' });
  expect(criado.appSecret).toBe('••••••••');
  expect(criado.instagramAppSecret).toBe('••••••••');
  const [listado] = await metaApps.listar();
  expect(JSON.stringify(listado)).not.toMatch(/segredo|enc1:/);
});

test('com sub-app do Instagram, id e segredo saem dele — juntos', async () => {
  const app = await metaApps.criar({ name: 'A', appId: '111', appSecret: 's-fb', instagramAppId: '222', instagramAppSecret: 's-ig' });
  expect(await metaApps.credenciais(app.id)).toMatchObject({ appId: '222', appSecret: 's-ig' });
  const simples = await metaApps.criar({ name: 'B', appId: '333', appSecret: 's-b' });
  expect(await metaApps.credenciais(simples.id)).toMatchObject({ appId: '333', appSecret: 's-b' });
});

test('o primeiro app vira o padrão; remover o padrão promove o mais antigo', async () => {
  const a = await metaApps.criar({ name: 'A', appId: '1', appSecret: 'x' });
  const b = await metaApps.criar({ name: 'B', appId: '2', appSecret: 'y' });
  expect((await metaApps.credenciais(null)).id).toBe(a.id);
  await metaApps.definirPadrao(b.id);
  expect((await metaApps.credenciais(null)).id).toBe(b.id);
  await metaApps.remover(b.id);
  expect((await metaApps.credenciais(null)).id).toBe(a.id);
});

test('editar sem mandar segredo mantém o que estava; mandando, cifra o novo', async () => {
  const a = await metaApps.criar({ name: 'A', appId: '1', appSecret: 'velho' });
  await metaApps.atualizar(a.id, { name: 'A2', appSecret: '' });
  expect((await metaApps.credenciais(a.id)).appSecret).toBe('velho');
  await metaApps.atualizar(a.id, { appSecret: 'novo' });
  expect((await metaApps.credenciais(a.id)).appSecret).toBe('novo');
  const [linha] = await banco.sql`select app_secret from meta_apps where id = ${a.id}`;
  expect(linha.appSecret).toMatch(/^enc1:/);
});

test('a lista diz quantas contas cada app carrega e quantas estão com problema', async () => {
  const a = await metaApps.criar({ name: 'A', appId: '1', appSecret: 'x' });
  await banco.criarConta({ username: 'ok', metaAppId: a.id });
  await banco.criarConta({ username: 'ruim', metaAppId: a.id, healthStatus: 'token_invalido' });
  const [listado] = await metaApps.listar();
  expect(listado).toMatchObject({ contas: 2, comProblema: 1 });
});
