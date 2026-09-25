'use strict';

/**
 * Multiusuário, pela API de verdade (HTTP contra o app, banco de teste).
 *
 * O que estes testes protegem:
 *   cadastro que entra sozinho   → só entra depois que o admin aprova
 *   bloqueio que demora          → bloqueado perde o acesso na hora, token vivo ou não
 *   dado de um no painel do outro → toda lista, leitura e alteração é do dono;
 *                                   id de outra pessoa se comporta como inexistente
 *   conta alheia num envio        → não dá para publicar com a conta de outro
 *   tempo real vazando            → evento vai só para o navegador do dono
 *   senha adivinhada em série     → freio depois de 8 erros
 */

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'senha-do-ambiente';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.PUBLIC_URL = 'http://localhost:3000';

const banco = require('./helpers/banco');
const { sql } = banco;
const app = require('../src/app');
const senhas = require('../src/services/senhaDoPainel');
const { _freio } = require('../src/routes/authRoutes');

let servidor, BASE;
beforeAll(async () => {
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  BASE = `http://127.0.0.1:${servidor.address().port}`;
});
afterAll(() => new Promise(r => servidor.close(r)));

beforeEach(async () => {
  await banco.limpar();
  _freio.erros.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function api(metodo, rota, { token, corpo } = {}) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados; try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados };
}

const entrar = (username, password) => api('POST', '/auth/login', { corpo: { username, password } });
const tokenDoAdmin = async () => (await entrar('admin', 'senha-do-ambiente')).dados.token;

/** Usuário aprovado, com token. */
async function usuarioAtivo(nome) {
  const email = `${nome}@teste.com`;
  const u = await banco.criarUsuario({ nome, email, senhaHash: senhas.gerar('senha-boa-123'), status: 'ativo' });
  const { dados } = await entrar(email, 'senha-boa-123');
  return { ...u, token: dados.token };
}

// ── Cadastro ────────────────────────────────────────────────────────────────

describe('cadastro', () => {
  test('cria como pendente, sem entrar, e avisa o admin', async () => {
    const r = await api('POST', '/auth/cadastro', { corpo: { nome: 'Ana', email: 'Ana@Teste.com', senha: 'senha-boa-123' } });
    expect(r.status).toBe(201);
    expect(r.dados.token).toBeUndefined();

    const [u] = await sql`select * from usuarios where email = 'ana@teste.com'`;
    expect(u).toMatchObject({ status: 'pendente', papel: 'usuario' });
    expect(u.senhaHash).not.toContain('senha-boa-123');

    const avisos = await sql`select * from notificacoes where usuario_id = ${banco.DONO_ID} and event_type = 'cadastro'`;
    expect(avisos).toHaveLength(1);
    expect(avisos[0].mensagem).toContain('ana@teste.com');
  });

  test.each([
    [{ nome: '', email: 'a@b.com', senha: 'senha-boa-123' }, 'NOME_INVALIDO'],
    [{ nome: 'Ana', email: 'nao-e-email', senha: 'senha-boa-123' }, 'EMAIL_INVALIDO'],
    [{ nome: 'Ana', email: 'a@b.com', senha: 'curta' }, 'SENHA_CURTA'],
    [{ nome: 'Ana', email: 'admin', senha: 'senha-boa-123' }, 'EMAIL_INVALIDO'],
  ])('recusa %o', async (corpo, codigo) => {
    const r = await api('POST', '/auth/cadastro', { corpo });
    expect(r.status).toBe(400);
    expect(r.dados.code).toBe(codigo);
    expect(await sql`select id from usuarios where papel = 'usuario'`).toHaveLength(0);
  });

  test('e-mail repetido (qualquer caixa) é recusado', async () => {
    await api('POST', '/auth/cadastro', { corpo: { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-boa-123' } });
    const r = await api('POST', '/auth/cadastro', { corpo: { nome: 'Outra', email: 'ANA@teste.com', senha: 'senha-boa-123' } });
    expect(r.status).toBe(409);
    expect(r.dados.code).toBe('EMAIL_EM_USO');
  });
});

// ── Login ───────────────────────────────────────────────────────────────────

describe('login', () => {
  test('pendente não entra, e a mensagem diz por quê', async () => {
    await api('POST', '/auth/cadastro', { corpo: { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-boa-123' } });
    const r = await entrar('ana@teste.com', 'senha-boa-123');
    expect(r.status).toBe(403);
    expect(r.dados.code).toBe('CADASTRO_PENDENTE');
    expect(r.dados.token).toBeUndefined();
  });

  test('senha errada de pendente não revela que o cadastro existe', async () => {
    await api('POST', '/auth/cadastro', { corpo: { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-boa-123' } });
    const errada = await entrar('ana@teste.com', 'outra-senha-1');
    const inexistente = await entrar('ninguem@teste.com', 'outra-senha-1');
    expect(errada).toEqual(inexistente);
    expect(errada.status).toBe(401);
  });

  test('aprovado entra com e-mail em qualquer caixa', async () => {
    await banco.criarUsuario({ email: 'bia@teste.com', senhaHash: senhas.gerar('senha-boa-123') });
    const r = await entrar('BIA@teste.com', 'senha-boa-123');
    expect(r.status).toBe(200);
    expect(r.dados.usuario).toMatchObject({ email: 'bia@teste.com', papel: 'usuario' });
    expect(r.dados.usuario.senhaHash).toBeUndefined();
  });

  test('admin entra com a senha do ambiente; com senha própria, as duas valem', async () => {
    expect((await entrar('admin', 'senha-do-ambiente')).status).toBe(200);
    await sql`update usuarios set senha_hash = ${senhas.gerar('senha-propria-1')} where id = ${banco.DONO_ID}`;
    expect((await entrar('admin', 'senha-propria-1')).status).toBe(200);
    expect((await entrar('ADMIN', 'senha-do-ambiente')).status).toBe(200);
    expect((await entrar('admin', 'chute-qualquer')).status).toBe(401);
  });

  test('a senha do ambiente não abre conta de usuário comum', async () => {
    await banco.criarUsuario({ email: 'bia@teste.com', senhaHash: senhas.gerar('senha-boa-123') });
    expect((await entrar('bia@teste.com', 'senha-do-ambiente')).status).toBe(401);
  });

  test('8 erros seguidos travam o login por um tempo, até com a senha certa', async () => {
    await banco.criarUsuario({ email: 'bia@teste.com', senhaHash: senhas.gerar('senha-boa-123') });
    for (let i = 0; i < 8; i++) expect((await entrar('bia@teste.com', 'errada-errada')).status).toBe(401);
    const r = await entrar('bia@teste.com', 'senha-boa-123');
    expect(r.status).toBe(429);
    expect(r.dados.code).toBe('MUITAS_TENTATIVAS');
  });

  test('/auth/me diz quem está logado', async () => {
    const bia = await usuarioAtivo('bia');
    const r = await api('GET', '/auth/me', { token: bia.token });
    expect(r.dados).toMatchObject({ id: bia.id, papel: 'usuario', email: 'bia@teste.com' });
  });

  test('token da versão antiga (sem usuário) não entra mais', async () => {
    const velho = require('jsonwebtoken').sign({ username: 'admin' }, process.env.JWT_SECRET);
    expect((await api('GET', '/accounts', { token: velho })).status).toBe(401);
  });
});

// ── Aprovação pelo admin ────────────────────────────────────────────────────

describe('gestão de usuários', () => {
  async function pendente() {
    await api('POST', '/auth/cadastro', { corpo: { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-boa-123' } });
    return (await sql`select * from usuarios where email = 'ana@teste.com'`)[0];
  }

  test('só o admin acessa', async () => {
    const bia = await usuarioAtivo('bia');
    expect((await api('GET', '/usuarios', { token: bia.token })).status).toBe(403);
    expect((await api('GET', '/usuarios')).status).toBe(401);
  });

  test('lista pendentes primeiro, com a contagem', async () => {
    await usuarioAtivo('bia');
    await pendente();
    const r = await api('GET', '/usuarios', { token: await tokenDoAdmin() });
    expect(r.dados.pendentes).toBe(1);
    expect(r.dados.usuarios[0]).toMatchObject({ email: 'ana@teste.com', status: 'pendente' });
    expect(JSON.stringify(r.dados)).not.toContain('senha');
  });

  test('aprovar libera o login', async () => {
    const ana = await pendente();
    const r = await api('POST', `/usuarios/${ana.id}/aprovar`, { token: await tokenDoAdmin() });
    expect(r.dados.usuario.status).toBe('ativo');
    expect((await entrar('ana@teste.com', 'senha-boa-123')).status).toBe(200);
  });

  test('recusar mantém fora', async () => {
    const ana = await pendente();
    await api('POST', `/usuarios/${ana.id}/recusar`, { token: await tokenDoAdmin() });
    expect((await entrar('ana@teste.com', 'senha-boa-123')).dados.code).toBe('CADASTRO_RECUSADO');
  });

  test('bloquear corta o acesso na hora e pausa os envios dele', async () => {
    const bia = await usuarioAtivo('bia');
    const job = await banco.criarJob({ usuarioId: bia.id, status: 'waiting_interval' });
    await sql`insert into queue_jobs (name, data) values ('job_round', ${sql.json({ jobId: job.id })})`;
    expect((await api('GET', '/accounts', { token: bia.token })).status).toBe(200);

    const r = await api('POST', `/usuarios/${bia.id}/bloquear`, { token: await tokenDoAdmin() });
    expect(r.dados.pausados.envios).toBe(1);

    // O mesmo token, ainda dentro dos 30 dias, já não serve.
    expect((await api('GET', '/accounts', { token: bia.token })).status).toBe(401);
    expect((await entrar('bia@teste.com', 'senha-boa-123')).dados.code).toBe('CONTA_BLOQUEADA');
    expect((await sql`select status from jobs where id = ${job.id}`)[0].status).toBe('paused');
    expect(await sql`select id from queue_jobs`).toHaveLength(0);

    await api('POST', `/usuarios/${bia.id}/reativar`, { token: await tokenDoAdmin() });
    expect((await api('GET', '/accounts', { token: bia.token })).status).toBe(200);
  });

  test('transição fora de ordem é recusada', async () => {
    const ana = await pendente();
    const r = await api('POST', `/usuarios/${ana.id}/bloquear`, { token: await tokenDoAdmin() });
    expect(r.status).toBe(409);
  });

  test('o admin não mexe em si mesmo por aqui', async () => {
    const token = await tokenDoAdmin();
    expect((await api('POST', `/usuarios/${banco.DONO_ID}/bloquear`, { token })).status).toBe(400);
    expect((await api('DELETE', `/usuarios/${banco.DONO_ID}`, { token, corpo: { confirmacao: '' } })).status).toBe(400);
  });

  test('apagar pede o e-mail como confirmação e leva tudo do usuário', async () => {
    const bia = await usuarioAtivo('bia');
    await banco.criarConta({ usuarioId: bia.id, username: 'da_bia' });
    await banco.criarConta({ username: 'do_admin' });
    const token = await tokenDoAdmin();

    expect((await api('DELETE', `/usuarios/${bia.id}`, { token, corpo: {} })).status).toBe(400);
    const r = await api('DELETE', `/usuarios/${bia.id}`, { token, corpo: { confirmacao: 'bia@teste.com' } });
    expect(r.dados.ok).toBe(true);
    expect((await sql`select username from accounts`).map(c => c.username)).toEqual(['do_admin']);
  });
});

// ── Isolamento ──────────────────────────────────────────────────────────────

describe('isolamento entre usuários', () => {
  let ana, bia, contaDaAna, midiaDaAna;
  beforeEach(async () => {
    ana = await usuarioAtivo('ana');
    bia = await usuarioAtivo('bia');
    contaDaAna = await banco.criarConta({ usuarioId: ana.id, username: 'loja_da_ana', accessToken: 'x', igUserId: '1' });
    midiaDaAna = await banco.criarMidia({ usuarioId: ana.id, filename: 'ana.mp4' });
    await banco.criarLegenda({ usuarioId: ana.id, title: 'da ana' });
    await banco.criarPost({ usuarioId: ana.id, accountIds: [contaDaAna.id], status: 'erro' });
    await sql`insert into notificacoes (usuario_id, event_type, titulo) values (${ana.id}, 'sistema', 'aviso da ana')`;
  });

  test.each([
    ['/accounts', d => d.accounts],
    ['/media', d => d.files],
    ['/legends', d => d],
    ['/posts', d => d.posts],
    ['/posts/fila', d => d.itens],
    ['/jobs', d => d],
    ['/loops', d => d],
    ['/campaigns', d => d.campaigns],
    ['/notificacoes', d => d.itens],
    ['/health', d => d.accounts],
  ])('%s: a Bia não vê nada da Ana', async (rota, lista) => {
    const daAna = await api('GET', rota, { token: ana.token });
    const daBia = await api('GET', rota, { token: bia.token });
    expect(daBia.status).toBe(200);
    expect(lista(daBia.dados)).toHaveLength(0);
    if (!['/jobs', '/loops', '/campaigns'].includes(rota)) expect(lista(daAna.dados).length).toBeGreaterThan(0);
  });

  test('painel e métricas da Bia não somam as contas da Ana', async () => {
    const d = (await api('GET', '/dashboard', { token: bia.token })).dados;
    expect(d.totalAccounts).toBe(0);
    expect(d.totalPosts).toBe(0);
    const g = (await api('GET', '/analytics/global-metrics?force=true', { token: bia.token })).dados;
    expect(g.connectedAccountsCount).toBe(0);
  });

  test('id da Ana nas mãos da Bia é como id inexistente', async () => {
    expect((await api('POST', `/accounts/${contaDaAna.id}/sync`, { token: bia.token })).status).toBe(404);
    expect((await api('DELETE', `/accounts/${contaDaAna.id}`, { token: bia.token })).status).toBe(404);
    await api('DELETE', `/media/${midiaDaAna.id}`, { token: bia.token });
    expect(await sql`select id from media where id = ${midiaDaAna.id}`).toHaveLength(1);
    expect(await sql`select id from accounts where id = ${contaDaAna.id}`).toHaveLength(1);
  });

  test('a Bia não publica com a conta da Ana', async () => {
    const { createPost } = require('../src/controllers/postController');
    let resposta;
    await createPost({
      user: { id: bia.id, papel: 'usuario' }, files: [],
      body: { mediaIds: '[]', accounts: JSON.stringify([contaDaAna.id]), intervalMinutes: '5' },
    }, { status(c) { resposta = { code: c }; return this; }, json(c) { resposta = { ...resposta, corpo: c }; return this; } });
    expect(resposta.code).toBe(400);
    expect(await sql`select id from jobs`).toHaveLength(0);
  });

  test('a Bia não monta campanha com a conta nem com a mídia da Ana', async () => {
    const minhaMidia = await banco.criarMidia({ usuarioId: bia.id, filename: 'bia.mp4' });
    const r = await api('POST', '/campaigns', { token: bia.token, corpo: {
      name: 'x', accountIds: [contaDaAna.id], contentIds: [minhaMidia.id],
    } });
    expect(r.status).toBe(404);
    expect(r.dados.code).toBe('ACCOUNT_NOT_FOUND');

    const minhaConta = await banco.criarConta({ usuarioId: bia.id, username: 'loja_da_bia' });
    const r2 = await api('POST', '/campaigns', { token: bia.token, corpo: {
      name: 'x', accountIds: [minhaConta.id], contentIds: [midiaDaAna.id],
    } });
    expect(r2.dados.code).toBe('CONTENT_NOT_FOUND');
  });

  test('a conta do Instagram já conectada por um não pode ser presa por outro', async () => {
    const graph = require('../src/services/instagramAPI');
    const conexao = require('../src/services/conexao');
    jest.spyOn(graph, 'perfil').mockResolvedValue({ igUserId: '1', username: 'loja_da_ana', accountType: 'BUSINESS', followers: null, following: null, postsCount: null });
    jest.spyOn(graph, 'renovarToken').mockResolvedValue({ token: 'novo', expiraEm: new Date(Date.now() + 86_400_000) });
    await expect(conexao.conectarPorToken('tok', 'new', bia.id)).rejects.toThrow(/outro usuário/);
    expect((await sql`select usuario_id from accounts where ig_user_id = '1'`)[0].usuarioId).toBe(ana.id);
  });

  test('meta apps: usuário vê só nome e id, e não cadastra', async () => {
    await require('../src/repos/metaApps').criar({ name: 'App', appId: '123', appSecret: 'segredo' });
    const lista = (await api('GET', '/meta-apps', { token: bia.token })).dados;
    expect(lista).toEqual([expect.objectContaining({ name: 'App', appId: '123' })]);
    expect(lista[0].appSecret).toBeUndefined();
    expect(lista[0].contas).toBeUndefined();
    expect((await api('POST', '/meta-apps', { token: bia.token, corpo: { name: 'x', appId: '1', appSecret: 's' } })).status).toBe(403);
  });

  test('marcar todas como lidas mexe só nas notificações de quem pediu', async () => {
    await api('POST', '/notificacoes/lidas', { token: bia.token });
    expect((await api('GET', '/notificacoes', { token: ana.token })).dados.naoLidas).toBe(1);
  });
});

// ── Tempo real ──────────────────────────────────────────────────────────────

describe('tempo real', () => {
  test('o evento chega só ao navegador do dono; sem dono, a ninguém', () => {
    const { addClient, removeClient, broadcast } = require('../src/events/broadcaster');
    const falso = () => ({ writable: true, recebido: [], write(m) { this.recebido.push(m); } });
    const daAna = falso(), daBia = falso();
    addClient(daAna, 'ana-id');
    addClient(daBia, 'bia-id');

    broadcast('posts', { action: 'created' }, 'ana-id');
    expect(daAna.recebido).toHaveLength(1);
    expect(daBia.recebido).toHaveLength(0);

    broadcast('posts', { action: 'created' });
    expect(daAna.recebido).toHaveLength(1);
    expect(daBia.recebido).toHaveLength(0);

    removeClient(daAna);
    removeClient(daBia);
  });
});

// ── Recuperação de senha ────────────────────────────────────────────────────

describe('recuperação de senha por e-mail', () => {
  const email = require('../src/services/email');
  let enviados;
  beforeEach(() => {
    enviados = [];
    jest.spyOn(email, 'configurado').mockReturnValue(true);
    jest.spyOn(email, 'enviar').mockImplementation(async m => { enviados.push(m); });
  });
  const codigoDo = m => new URL(m.texto.match(/https?:\/\/\S+/)[0]).searchParams.get('codigo');

  test('sem SMTP, a tela sabe que não há recuperação', async () => {
    email.configurado.mockReturnValue(false);
    expect((await api('GET', '/auth/opcoes')).dados.recuperacaoPorEmail).toBe(false);
    expect((await api('POST', '/auth/esqueci', { corpo: { email: 'a@b.com' } })).dados.code).toBe('EMAIL_NAO_CONFIGURADO');
  });

  test('mesma resposta exista o e-mail ou não; só quem existe recebe', async () => {
    const bia = await usuarioAtivo('bia');
    const existe = await api('POST', '/auth/esqueci', { corpo: { email: 'BIA@teste.com' } });
    const naoExiste = await api('POST', '/auth/esqueci', { corpo: { email: 'ninguem@teste.com' } });
    expect(existe).toEqual(naoExiste);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe(bia.email);
    expect(enviados[0].texto).toContain('http://localhost:5173/redefinir-senha?codigo=');
  });

  test('o banco guarda só o hash do código', async () => {
    await usuarioAtivo('bia');
    await api('POST', '/auth/esqueci', { corpo: { email: 'bia@teste.com' } });
    const [p] = await sql`select token_hash from recuperacoes_de_senha`;
    expect(p.tokenHash).not.toBe(codigoDo(enviados[0]));
    expect(p.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('o link troca a senha uma vez, e derruba as sessões antigas', async () => {
    const bia = await usuarioAtivo('bia');
    await api('POST', '/auth/esqueci', { corpo: { email: 'bia@teste.com' } });
    const codigo = codigoDo(enviados[0]);

    await new Promise(r => setTimeout(r, 1100)); // o token antigo fica claramente anterior
    const r = await api('POST', '/auth/redefinir', { corpo: { codigo, senha: 'senha-nova-456' } });
    expect(r.dados.ok).toBe(true);

    expect((await entrar('bia@teste.com', 'senha-boa-123')).status).toBe(401);
    expect((await entrar('bia@teste.com', 'senha-nova-456')).status).toBe(200);
    expect((await api('GET', '/accounts', { token: bia.token })).status).toBe(401);

    const deNovo = await api('POST', '/auth/redefinir', { corpo: { codigo, senha: 'outra-senha-789' } });
    expect(deNovo.dados.code).toBe('LINK_INVALIDO');
  });

  test('link vencido, inventado ou com senha curta não troca nada', async () => {
    await usuarioAtivo('bia');
    await api('POST', '/auth/esqueci', { corpo: { email: 'bia@teste.com' } });
    const codigo = codigoDo(enviados[0]);

    expect((await api('POST', '/auth/redefinir', { corpo: { codigo, senha: 'curta' } })).dados.code).toBe('SENHA_CURTA');
    expect((await api('POST', '/auth/redefinir', { corpo: { codigo: 'inventado', senha: 'senha-nova-456' } })).dados.code).toBe('LINK_INVALIDO');
    await sql`update recuperacoes_de_senha set expira_em = now() - interval '1 minute'`;
    expect((await api('POST', '/auth/redefinir', { corpo: { codigo, senha: 'senha-nova-456' } })).dados.code).toBe('LINK_INVALIDO');
    expect((await entrar('bia@teste.com', 'senha-boa-123')).status).toBe(200);
  });

  test('pedir de novo invalida o link anterior', async () => {
    await usuarioAtivo('bia');
    await api('POST', '/auth/esqueci', { corpo: { email: 'bia@teste.com' } });
    await api('POST', '/auth/esqueci', { corpo: { email: 'bia@teste.com' } });
    const r = await api('POST', '/auth/redefinir', { corpo: { codigo: codigoDo(enviados[0]), senha: 'senha-nova-456' } });
    expect(r.dados.code).toBe('LINK_INVALIDO');
    expect((await api('POST', '/auth/redefinir', { corpo: { codigo: codigoDo(enviados[1]), senha: 'senha-nova-456' } })).dados.ok).toBe(true);
  });

  test('bloqueado não recebe link', async () => {
    await banco.criarUsuario({ email: 'bloq@teste.com', status: 'bloqueado', senhaHash: senhas.gerar('senha-boa-123') });
    await api('POST', '/auth/esqueci', { corpo: { email: 'bloq@teste.com' } });
    expect(enviados).toHaveLength(0);
  });
});
