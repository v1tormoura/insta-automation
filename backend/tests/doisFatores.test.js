'use strict';

/**
 * Login em dois fatores e registro de atividade, pela API de verdade.
 *
 * O que importa aqui:
 *  • o código TOTP bate com o vetor oficial da RFC 6238;
 *  • senha certa de quem ligou o 2FA NÃO devolve sessão — só o desafio, e o
 *    desafio não abre nenhuma rota;
 *  • o mesmo código não entra duas vezes; o de reserva vale uma vez;
 *  • o que o usuário faz aparece no registro, e um usuário não vê o do outro.
 */

process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD = 'senha-do-ambiente';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const banco = require('./helpers/banco');
const { sql } = banco;
const app = require('../src/app');
const senhas = require('../src/services/senhaDoPainel');
const dois = require('../src/services/doisFatores');
const atividade = require('../src/services/registroDeAtividade');
const { _freio } = require('../src/routes/authRoutes');

describe('TOTP', () => {
  test('vetores da RFC 6238 (SHA1, 6 dígitos)', () => {
    const segredo = dois.base32(Buffer.from('12345678901234567890'));
    expect(dois.codigoNoPasso(segredo, Math.floor(59 / 30))).toBe('287082');
    expect(dois.codigoNoPasso(segredo, Math.floor(1111111109 / 30))).toBe('081804');
    expect(dois.codigoNoPasso(segredo, Math.floor(2000000000 / 30))).toBe('279037');
  });

  test('aceita ±30 s e recusa passo já usado', () => {
    const s = dois.gerarSegredo();
    const agora = Date.now();
    const p = dois.passoDe(agora);
    expect(dois.conferir(s, dois.codigoNoPasso(s, p - 1), { agora })).toBe(p - 1);
    expect(dois.conferir(s, dois.codigoNoPasso(s, p - 3), { agora })).toBeNull();
    expect(dois.conferir(s, dois.codigoNoPasso(s, p), { agora, ultimoPasso: p })).toBeNull();
    expect(dois.conferir(s, 'abc', { agora })).toBeNull();
  });

  test('código de reserva vale uma vez, com ou sem hífen', () => {
    const { codigos, hashes } = dois.gerarReserva();
    expect(codigos).toHaveLength(8);
    const sobra = dois.usarReserva(hashes, codigos[0].replace('-', '').toUpperCase());
    expect(sobra).toHaveLength(7);
    expect(dois.usarReserva(sobra, codigos[0])).toBeNull();
  });
});

describe('descrição das ações', () => {
  test('ações conhecidas em português, barulho fica de fora', () => {
    expect(atividade.descrever('POST', '/posts')).toBe('Mandou publicar');
    expect(atividade.descrever('DELETE', '/loops/abc')).toBe('Apagou um loop');
    expect(atividade.descrever('PATCH', '/notificacoes/1/lida')).toBeNull();
    expect(atividade.descrever('POST', '/rota-nova')).toBe('Fez algo em rota-nova');
  });
});

describe('API', () => {
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
  const esperar = () => new Promise(r => setTimeout(r, 80)); // o registro grava depois da resposta

  async function usuarioCom2fa() {
    const email = 'ana@teste.com';
    await banco.criarUsuario({ nome: 'Ana', email, senhaHash: senhas.gerar('senha-boa-123'), status: 'ativo' });
    const { dados: { token } } = await entrar(email, 'senha-boa-123');
    const ini = await api('POST', '/conta/2fa/iniciar', { token });
    expect(ini.status).toBe(200);
    expect(ini.dados.qr).toMatch(/^data:image\/png;base64,/);
    expect(ini.dados.otpauth).toContain(ini.dados.segredo);

    const errado = await api('POST', '/conta/2fa/ativar', { token, corpo: { codigo: '000000' } });
    expect(errado.status).toBe(400);

    const passo = dois.passoDe();
    const at = await api('POST', '/conta/2fa/ativar', { token, corpo: { codigo: dois.codigoNoPasso(ini.dados.segredo, passo) } });
    expect(at.status).toBe(200);
    expect(at.dados.ativo).toBe(true);
    expect(at.dados.codigos).toHaveLength(8);
    return { email, token, segredo: ini.dados.segredo, reserva: at.dados.codigos, passo };
  }

  test('com 2FA ligado, a senha só devolve o desafio — e o desafio não é sessão', async () => {
    const { email, segredo, passo } = await usuarioCom2fa();
    const r = await entrar(email, 'senha-boa-123');
    expect(r.status).toBe(200);
    expect(r.dados.token).toBeUndefined();
    expect(r.dados.precisa2fa).toBe(true);

    expect((await api('GET', '/auth/me', { token: r.dados.desafio })).status).toBe(401);

    // O código usado para ativar não entra de novo.
    const repetido = await api('POST', '/auth/2fa', { corpo: { desafio: r.dados.desafio, codigo: dois.codigoNoPasso(segredo, passo) } });
    expect(repetido.status).toBe(401);

    const ok = await api('POST', '/auth/2fa', { corpo: { desafio: r.dados.desafio, codigo: dois.codigoNoPasso(segredo, passo + 1) } });
    expect(ok.status).toBe(200);
    expect((await api('GET', '/auth/me', { token: ok.dados.token })).dados.email).toBe(email);
  });

  test('código de reserva entra uma vez; desligar pede senha e código', async () => {
    const { email, token, reserva } = await usuarioCom2fa();
    const d1 = (await entrar(email, 'senha-boa-123')).dados.desafio;
    const r1 = await api('POST', '/auth/2fa', { corpo: { desafio: d1, codigo: reserva[0] } });
    expect(r1.status).toBe(200);
    expect(r1.dados.reservaRestante).toBe(7);
    const d2 = (await entrar(email, 'senha-boa-123')).dados.desafio;
    expect((await api('POST', '/auth/2fa', { corpo: { desafio: d2, codigo: reserva[0] } })).status).toBe(401);

    expect((await api('POST', '/conta/2fa/desativar', { token, corpo: { senha: 'errada', codigo: reserva[1] } })).status).toBe(401);
    const off = await api('POST', '/conta/2fa/desativar', { token, corpo: { senha: 'senha-boa-123', codigo: reserva[1] } });
    expect(off.dados.ativo).toBe(false);
    expect((await entrar(email, 'senha-boa-123')).dados.token).toBeTruthy();
  });

  test('admin desliga o 2FA de quem perdeu o celular', async () => {
    const { email } = await usuarioCom2fa();
    const [u] = await sql`select id from usuarios where email = ${email}`;
    const admin = (await entrar('admin', 'senha-do-ambiente')).dados.token;
    expect((await api('POST', `/usuarios/${u.id}/2fa/desligar`, { token: admin })).status).toBe(200);
    expect((await entrar(email, 'senha-boa-123')).dados.token).toBeTruthy();
  });

  test('registro: login, senha errada e ações; cada um vê só o próprio', async () => {
    const { email, token } = await usuarioCom2fa();
    await entrar(email, 'senha-errada');
    await api('POST', '/legends', { token, corpo: { title: 'Oi', text: 'legenda' } });
    await esperar();

    const meu = await api('GET', '/atividade', { token });
    const acoes = meu.dados.itens.map(i => i.acao);
    expect(acoes).toEqual(expect.arrayContaining([
      'Entrou no painel', 'Ligou o login em dois fatores', 'Tentativa de login com senha errada', 'Criou uma legenda',
    ]));
    expect(meu.dados.itens.every(i => i.usuario.email === email)).toBe(true);

    const admin = (await entrar('admin', 'senha-do-ambiente')).dados.token;
    await esperar();
    const todos = await api('GET', '/atividade', { token: admin });
    expect(new Set(todos.dados.itens.map(i => i.usuario.email)).size).toBeGreaterThan(1);
    // Usuário comum pedindo o de outro continua vendo só o próprio.
    const [adm] = await sql`select id from usuarios where papel = 'admin'`;
    const outro = await api('GET', `/atividade?usuario=${adm.id}`, { token });
    expect(outro.dados.itens.every(i => i.usuario.email === email)).toBe(true);
  });
});
