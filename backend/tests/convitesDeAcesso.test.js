'use strict';

/**
 * Convites de testador do app.
 *
 * ── O que estes testes protegem
 *
 * A tela promete "convite" e a Meta não tem endpoint para isso. Confirmado na
 * referência dela: `POST /{app-id}/roles` responde que a operação não pode ser
 * executada no ponto de extremidade, os papéis que ela conhece são
 * administrators/developers/testers/insights users — nenhum é o testador do
 * Instagram — e o campo `user` pede o ID numérico de um usuário do Facebook.
 *
 * Então o valor todo está em três coisas pequenas, e cada uma quebra calada:
 *
 *   o @ normalizado    → "@Fulano" e "fulano" viram dois convites para a mesma
 *                        conta, e nenhum deles fecha como conectado
 *   o link do painel   → sem App configurado, `/apps/undefined/roles` leva a
 *                        uma página de erro da Meta em vez de dizer o que falta
 *   conectado derivado → é lido das contas, não gravado. Se fosse gravado,
 *                        precisaria de um gancho no login, e um gancho que
 *                        falhe deixa o convite mentindo para sempre
 */

const { normalizarArroba, MAX } = require('../src/services/arrobaDoInstagram');

describe('o @ do Instagram, normalizado', () => {
  test('tira a arroba e baixa a caixa', () => {
    /* O Instagram não diferencia maiúscula; se nós diferenciássemos, o convite
       de "@Fulano" nunca casaria com a conta "fulano". */
    expect(normalizarArroba('@Fulano')).toBe('fulano');
    expect(normalizarArroba('  FULANO  ')).toBe('fulano');
    expect(normalizarArroba('@@fulano')).toBe('fulano');
  });

  test('aceita o link do perfil colado inteiro', () => {
    /* É o gesto natural de quem está com o perfil aberto. Aceitar as três
       formas custa uma regex e evita ensinar a colar de outro jeito. */
    expect(normalizarArroba('instagram.com/beto_1')).toBe('beto_1');
    expect(normalizarArroba('https://www.instagram.com/beto_1/?hl=pt')).toBe('beto_1');
    expect(normalizarArroba('http://instagram.com/beto_1/')).toBe('beto_1');
  });

  test('só texto entra', () => {
    /* `String(valor)` faria de null o @ "null" e de [1,2] o @ "1,2" — dois @
       inválidos que passariam a parecer válidos. */
    for (const v of [null, undefined, 0, 42, [], ['fulano'], {}, true]) {
      expect(normalizarArroba(v)).toBe('');
    }
  });

  test('recusa o que o Instagram recusa', () => {
    expect(normalizarArroba('com espaço')).toBe('');
    expect(normalizarArroba('acentuação')).toBe('');
    expect(normalizarArroba('barra/dentro')).toBe('');
    expect(normalizarArroba('fim.')).toBe('');       // ponto no fim
    expect(normalizarArroba('')).toBe('');
    expect(normalizarArroba('@')).toBe('');
    expect(normalizarArroba('a'.repeat(MAX + 1))).toBe('');
    expect(normalizarArroba('a'.repeat(MAX))).toBe('a'.repeat(MAX));
  });

  test('o que passa não tem como virar outra URL', () => {
    /* Este valor entra no link do painel da Meta. Se `..` ou `%` passassem,
       o @ deixaria de ser um segmento e viraria caminho. */
    for (const v of ['..', '../../etc', 'a%2Fb', 'a?b=1', 'a#b', 'a b']) {
      expect(normalizarArroba(v)).toBe('');
    }
  });
});

/* ── As rotas, contra o banco ─────────────────────────────────────────────── */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
const banco = require('./helpers/banco');
const metaApps = require('../src/repos/metaApps');
const rotas = require('../src/routes/convitesRoutes');
const { painelDaMeta, jaConectados } = rotas;

const { chamarRota } = require('./helpers/rota');
let ADMIN;
/** Chama a rota como o admin, com req/res de mentira. */
const chamar = (metodo, caminho, req = {}) =>
  chamarRota(rotas, metodo, caminho, { user: { id: ADMIN.id, papel: 'admin' }, ...req });
const convitesGravados = () => banco.sql`select * from convites_de_acesso order by created_at`;

beforeEach(async () => { await banco.limpar(); ADMIN = await banco.dono(); });

describe('o link do painel da Meta', () => {
  test('sai do App padrão', async () => {
    await metaApps.criar({ name: 'A', appId: '790847580661717', appSecret: 's' });
    const p = await painelDaMeta(null);
    expect(p.appId).toBe('790847580661717');
    /* `roles/roles` é a página que tem a seção de testadores do Instagram. */
    expect(p.url).toBe('https://developers.facebook.com/apps/790847580661717/roles/roles/');
  });

  test('um App escolhido vence o padrão', async () => {
    await metaApps.criar({ name: 'A', appId: '111', appSecret: 's' });
    const b = await metaApps.criar({ name: 'B', appId: '222', appSecret: 's' });
    expect((await painelDaMeta(b.id)).appId).toBe('222');
  });

  test('sem App nenhum, o link é null e não um link quebrado', async () => {
    /* `/apps/undefined/roles/` abre uma página de erro da Meta — pior do que a
       tela dizer que falta configurar o App. */
    expect(await painelDaMeta(null)).toEqual({ appId: '', url: null });
  });

  test('id que não existe não derruba a rota', async () => {
    expect((await painelDaMeta('id-que-nao-existe')).url).toBeNull();
  });
});

describe('conectado é lido das contas, não gravado', () => {
  test('conta com token oficial conta como conectada', async () => {
    await banco.criarConta({ username: 'fulano', igUserId: '17841', accessToken: 'enc1:x' });
    expect([...await jaConectados()]).toEqual(['fulano']);
  });

  test('token sem igUserId não é conexão', async () => {
    /* Metade do par não publica em lugar nenhum. É o mesmo critério que a tela
       de contas usa para escrever "conectada". */
    await banco.criarConta({ username: 'meio1', accessToken: 'enc1:x' });
    await banco.criarConta({ username: 'meio2', igUserId: '17841' });
    expect([...await jaConectados()]).toEqual([]);
  });

  test('a comparação ignora a caixa', async () => {
    /* O convite era de "@Fulano", a conta chegou como "Fulano", e a lista
       dizia pendente para sempre. */
    await banco.criarConta({ username: 'Fulano', igUserId: '1', accessToken: 'enc1:x' });
    expect((await jaConectados()).has('fulano')).toBe(true);
  });

  test('GET marca o convite cuja conta já entrou', async () => {
    await chamar('post', '/', { body: { username: 'jaentrou' } });
    await chamar('post', '/', { body: { username: 'faltando' } });
    await banco.criarConta({ username: 'jaentrou', igUserId: '1', accessToken: 'enc1:x' });
    const r = await chamar('get', '/');
    expect(r.code).toBe(200);
    expect(r.corpo.convites.map(c => [c.username, c.conectado]).sort())
      .toEqual([['faltando', false], ['jaentrou', true]]);
  });
});

describe('pedir um convite', () => {
  test('grava o @ normalizado, não o que foi digitado', async () => {
    const r = await chamar('post', '/', { body: { username: '  @Fulano ' } });
    expect(r.code).toBe(201);
    expect((await convitesGravados()).map(c => c.username)).toEqual(['fulano']);
  });

  test('@ inválido é recusado antes de tocar o banco', async () => {
    for (const username of ['', '   ', '@', 'com espaço', null, 42, ['fulano']]) {
      expect((await chamar('post', '/', { body: { username } })).code).toBe(400);
    }
    expect(await convitesGravados()).toHaveLength(0);
  });

  test('pedir duas vezes o mesmo @ não é erro nem duplica', async () => {
    await chamar('post', '/', { body: { username: 'fulano' } });
    const r = await chamar('post', '/', { body: { username: '@FULANO' } });
    expect(r.code).toBe(201);
    expect(await convitesGravados()).toHaveLength(1);
  });

  test('o segundo pedido não rebaixa um convite já enviado', async () => {
    const { corpo } = await chamar('post', '/', { body: { username: 'fulano' } });
    await chamar('patch', '/:id/enviado', { params: { id: corpo.convite.id } });
    await chamar('post', '/', { body: { username: 'fulano' } });
    expect((await convitesGravados())[0].estado).toBe('enviado');
  });

  test('a observação é limitada; a que não é texto é ignorada', async () => {
    await chamar('post', '/', { body: { username: 'fulano', observacao: 'a'.repeat(500) } });
    expect((await convitesGravados())[0].observacao).toHaveLength(280);
    await chamar('post', '/', { body: { username: 'ciclano', observacao: { $ne: null } } });
    expect((await convitesGravados())[1].observacao).toBe('');
  });

  test('metaAppId que não é texto não entra', async () => {
    await chamar('post', '/', { body: { username: 'fulano', metaAppId: { $gt: '' } } });
    expect((await convitesGravados())[0].metaAppId).toBe('');
  });
});

describe('marcar como enviado e remover', () => {
  test('enviado grava a data', async () => {
    const { corpo } = await chamar('post', '/', { body: { username: 'fulano' } });
    const r = await chamar('patch', '/:id/enviado', { params: { id: corpo.convite.id } });
    expect(r.code).toBe(200);
    expect(r.corpo.convite.estado).toBe('enviado');
    expect(r.corpo.convite.enviadoEm).toBeInstanceOf(Date);
  });

  test('convite que não existe responde 404, não 200', async () => {
    const inexistente = '00000000-0000-0000-0000-000000000000';
    expect((await chamar('patch', '/:id/enviado', { params: { id: inexistente } })).code).toBe(404);
    expect((await chamar('delete', '/:id', { params: { id: inexistente } })).code).toBe(404);
    expect((await chamar('delete', '/:id', { params: { id: 'nem-uuid' } })).code).toBe(404);
  });
});

describe('a ligação com o resto do sistema', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler  = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('as rotas estão montadas e atrás do JWT', () => {
    /* Atrás do `auth` porque a fila de convites diz quais contas são nossas. */
    expect(ler('../src/app.js')).toMatch(/app\.use\('\/convites',\s*auth,\s*require\('\.\/routes\/convitesRoutes'\)\)/);
  });

  test('o estado conectado não é coluna — é deduzido', () => {
    const esquema = ler('../src/db/migrations/001_inicial.sql');
    const tabela = esquema.slice(esquema.indexOf('create table convites_de_acesso'));
    expect(tabela.slice(0, tabela.indexOf(');'))).not.toMatch(/conectado/);
  });

  test('a tela de contas chama as rotas de convite', () => {
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela).toContain("api.get('/convites'");
    expect(tela).toContain("api.post('/convites'");
    expect(tela).toContain('Pedir acesso via convite');
  });

  test('os caminhos de conexão estão no cabeçalho', () => {
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    expect(tela).toContain('Conectar Contas (OAuth)');
    expect(tela).toContain('copiarLinkOAuth');
  });

  test('a escolha de como abrir vem antes do fluxo em duas etapas', () => {
    const tela = ler('../../frontend/src/pages/Accounts.jsx');
    const inicio = tela.indexOf('async function openOAuthConnect');
    expect(inicio).toBeGreaterThan(-1);
    const seguinte = tela.slice(inicio + 1).search(/\n {2}(?:async )?function /);
    const corpo = seguinte === -1 ? tela.slice(inicio) : tela.slice(inicio, inicio + 1 + seguinte);
    expect(corpo).toContain('setEscolhaOAuth(');
    expect(corpo).not.toContain('setOauthModal({');
  });
});
