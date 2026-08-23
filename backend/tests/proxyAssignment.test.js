'use strict';

/**
 * Distribuição de proxies entre contas.
 *
 * O que estes testes protegem: o objetivo inteiro é UM IP por conta. Atribuir o
 * mesmo proxy a duas contas, ou gravar um proxy morto, desfaz o propósito — a
 * primeira recria o problema original, a segunda troca "conta no IP errado" por
 * "conta que não publica".
 */

const mockTestProxy = jest.fn();
jest.mock('../src/services/testProxy', () => {
  const fn = (...a) => mockTestProxy(...a);
  fn.testProxy      = fn;
  fn.getDirectIp    = jest.fn();
  fn.normalizeProxy = (p) => {
    const raw = String(p || '').trim();
    if (!raw) return '';
    return /^[a-z0-9+.-]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  };
  return fn;
});

const Account = require('../src/models/Account');
const {
  parseLista, testarLote, distribuirProxies, listarAtribuicoes, _mascarar,
} = require('../src/services/proxyAssignment');

describe('parseLista — formatos que os provedores entregam', () => {
  test('host:porta', () => {
    expect(parseLista('1.2.3.4:8080').urls).toEqual(['http://1.2.3.4:8080']);
  });

  test('host:porta:usuario:senha — o formato mais comum e o que mais quebrava', () => {
    // Colado cru viraria http://host:porta:user:senha e falharia sem explicação.
    expect(parseLista('1.2.3.4:9000:joao:segredo').urls)
      .toEqual(['http://joao:segredo@1.2.3.4:9000']);
  });

  test('usuario:senha@host:porta', () => {
    expect(parseLista('joao:segredo@1.2.3.4:9000').urls)
      .toEqual(['http://joao:segredo@1.2.3.4:9000']);
  });

  test('URL completa é preservada, inclusive socks5', () => {
    const { urls } = parseLista('socks5://1.2.3.4:1080\nhttp://a:b@5.6.7.8:3128');
    expect(urls).toEqual(['socks5://1.2.3.4:1080', 'http://a:b@5.6.7.8:3128']);
  });

  test('caractere especial na senha é codificado', () => {
    const { urls } = parseLista('1.2.3.4:9000:joao:se@nha#1');
    expect(urls[0]).toContain('se%40nha%231');
    expect(() => new URL(urls[0])).not.toThrow();
  });

  test('separa por vírgula e ponto e vírgula, não só quebra de linha', () => {
    expect(parseLista('1.2.3.4:80, 5.6.7.8:81; 9.9.9.9:82').urls).toHaveLength(3);
  });

  test('duplicata sai da lista — dois donos para o mesmo IP é o problema de volta', () => {
    expect(parseLista('1.2.3.4:80\n1.2.3.4:80\n1.2.3.4:80').urls).toHaveLength(1);
  });

  test('linha sem porta é recusada, não vira porta padrão silenciosa', () => {
    const { urls, invalidas } = parseLista('meuproxy.com');
    expect(urls).toHaveLength(0);
    expect(invalidas).toEqual(['meuproxy.com']);
  });

  test('lixo é reportado, não descartado em silêncio', () => {
    const { invalidas } = parseLista('isso nao e proxy\n1.2.3.4:80');
    expect(invalidas).toEqual(['isso nao e proxy']);
  });

  test('lista vazia não quebra', () => {
    expect(parseLista('').urls).toEqual([]);
    expect(parseLista(null).urls).toEqual([]);
  });
});

describe('testarLote — mede duas vezes para achar proxy rotativo', () => {
  beforeEach(() => mockTestProxy.mockReset());

  test('proxy estável passa', async () => {
    mockTestProxy.mockResolvedValue({ ok: true, ip: '8.8.8.8', latencyMs: 120 });
    const [r] = await testarLote(['http://1.2.3.4:80']);
    expect(r.ok).toBe(true);
    expect(r.rotativo).toBe(false);
    expect(mockTestProxy).toHaveBeenCalledTimes(2);
  });

  test('IP diferente entre as duas medições marca rotativo', async () => {
    mockTestProxy
      .mockResolvedValueOnce({ ok: true, ip: '8.8.8.8' })
      .mockResolvedValueOnce({ ok: true, ip: '9.9.9.9' });
    const [r] = await testarLote(['http://1.2.3.4:80']);
    expect(r.rotativo).toBe(true);
  });

  test('proxy morto não gasta a segunda medição', async () => {
    mockTestProxy.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' });
    const [r] = await testarLote(['http://1.2.3.4:80']);
    expect(r.ok).toBe(false);
    expect(r.erro).toBe('ECONNREFUSED');
    expect(mockTestProxy).toHaveBeenCalledTimes(1);
  });
});

describe('distribuirProxies', () => {
  let findOriginal, updateOriginal;
  const atualizacoes = [];

  /** Mock com IP fixo por URL — proxy estável devolve sempre o mesmo IP. */
  function ipPorUrl(mapa) {
    mockTestProxy.mockImplementation(async (url) => (
      mapa[url] ? { ok: true, ip: mapa[url], latencyMs: 100 } : { ok: false, error: 'nao mapeado' }
    ));
  }

  function comContas(contas) {
    Account.find = jest.fn(() => ({
      select: () => ({ lean: async () => contas }),
    }));
  }

  beforeEach(() => {
    findOriginal = Account.find;
    updateOriginal = Account.updateOne;
    atualizacoes.length = 0;
    Account.updateOne = jest.fn(async (filtro, update) => {
      atualizacoes.push({ filtro, update });
      return { acknowledged: true };
    });
    mockTestProxy.mockReset();
    mockTestProxy.mockResolvedValue({ ok: true, ip: '8.8.8.8', latencyMs: 100 });
  });

  afterEach(() => {
    Account.find = findOriginal;
    Account.updateOne = updateOriginal;
  });

  test('uma conta por proxy, nunca compartilhado', async () => {
    comContas([
      { _id: 'a', username: 'c1', proxy: '' },
      { _id: 'b', username: 'c2', proxy: '' },
    ]);
    // IP ESTÁVEL por proxy: as duas medições do mesmo proxy precisam devolver
    // o mesmo IP, senão ele seria (corretamente) marcado como rotativo.
    ipPorUrl({ 'http://1.2.3.4:80': '1.1.1.1', 'http://5.6.7.8:81': '2.2.2.2' });

    const r = await distribuirProxies({ texto: '1.2.3.4:80\n5.6.7.8:81' });

    expect(r.atribuidos).toBe(2);
    const urls = atualizacoes.map(a => a.update.$set.proxy);
    expect(new Set(urls).size).toBe(2);   // nenhum repetido
  });

  test('menos proxies que contas deixa conta sem — e diz quais', async () => {
    comContas([
      { _id: 'a', username: 'c1', proxy: '' },
      { _id: 'b', username: 'c2', proxy: '' },
      { _id: 'c', username: 'c3', proxy: '' },
    ]);
    const r = await distribuirProxies({ texto: '1.2.3.4:80' });

    expect(r.atribuidos).toBe(1);
    expect(r.contasSemProxy).toBe(2);
    expect(r.detalhes.filter(d => d.status === 'sem_proxy_disponivel')).toHaveLength(2);
  });

  test('proxy morto não é atribuído', async () => {
    comContas([{ _id: 'a', username: 'c1', proxy: '' }]);
    mockTestProxy.mockResolvedValue({ ok: false, error: 'timeout' });

    const r = await distribuirProxies({ texto: '1.2.3.4:80' });
    expect(r.atribuidos).toBe(0);
    expect(r.reprovados).toHaveLength(1);
    expect(Account.updateOne).not.toHaveBeenCalled();
  });

  test('proxy rotativo é recusado por padrão — ele quebra o login', async () => {
    comContas([{ _id: 'a', username: 'c1', proxy: '' }]);
    mockTestProxy
      .mockResolvedValueOnce({ ok: true, ip: '8.8.8.8' })
      .mockResolvedValueOnce({ ok: true, ip: '9.9.9.9' });

    const r = await distribuirProxies({ texto: '1.2.3.4:80' });
    expect(r.atribuidos).toBe(0);
    expect(r.rotativos).toHaveLength(1);
  });

  test('rotativo entra quando o usuário assume o risco', async () => {
    comContas([{ _id: 'a', username: 'c1', proxy: '' }]);
    mockTestProxy
      .mockResolvedValueOnce({ ok: true, ip: '8.8.8.8' })
      .mockResolvedValueOnce({ ok: true, ip: '9.9.9.9' });

    const r = await distribuirProxies({ texto: '1.2.3.4:80', permitirRotativo: true });
    expect(r.atribuidos).toBe(1);
  });

  test('conta que já tem proxy é preservada por padrão', async () => {
    comContas([
      { _id: 'a', username: 'c1', proxy: 'http://ja:tem@1.1.1.1:80' },
      { _id: 'b', username: 'c2', proxy: '' },
    ]);
    const r = await distribuirProxies({ texto: '5.6.7.8:81' });

    expect(r.atribuidos).toBe(1);
    expect(atualizacoes[0].filtro._id).toBe('b');
  });

  test('substituir=true troca também quem já tinha', async () => {
    comContas([
      { _id: 'a', username: 'c1', proxy: 'http://velho@1.1.1.1:80' },
      { _id: 'b', username: 'c2', proxy: '' },
    ]);
    ipPorUrl({ 'http://5.6.7.8:81': '3.3.3.3', 'http://9.9.9.9:82': '4.4.4.4' });

    const r = await distribuirProxies({ texto: '5.6.7.8:81\n9.9.9.9:82', substituir: true });
    expect(r.atribuidos).toBe(2);
  });

  test('proxy já usado por outra conta não é redistribuído', async () => {
    comContas([
      { _id: 'a', username: 'c1', proxy: 'http://1.2.3.4:80' },
      { _id: 'b', username: 'c2', proxy: '' },
    ]);
    const r = await distribuirProxies({ texto: '1.2.3.4:80' });

    expect(r.atribuidos).toBe(0);
    expect(r.contasSemProxy).toBe(1);
  });

  test('grava o IP de saída junto, para conferência depois', async () => {
    comContas([{ _id: 'a', username: 'c1', proxy: '' }]);
    await distribuirProxies({ texto: '1.2.3.4:80' });

    const set = atualizacoes[0].update.$set;
    expect(set.proxyIp).toBe('8.8.8.8');
    expect(set.proxyStatus).toBe('ok');
    expect(set.proxyLastCheck).toBeInstanceOf(Date);
  });

  test('lista sem nada válido não toca no banco', async () => {
    comContas([{ _id: 'a', username: 'c1', proxy: '' }]);
    const r = await distribuirProxies({ texto: 'nada aqui presta' });

    expect(r.atribuidos).toBe(0);
    expect(r.erro).toBeTruthy();
    expect(Account.updateOne).not.toHaveBeenCalled();
  });

  test('limita às contas escolhidas quando accountIds é informado', async () => {
    comContas([{ _id: 'b', username: 'c2', proxy: '' }]);
    await distribuirProxies({ texto: '1.2.3.4:80', accountIds: ['b'] });

    expect(Account.find).toHaveBeenCalledWith({ _id: { $in: ['b'] } });
  });
});

describe('_mascarar — senha não vaza para tela nem log', () => {
  test('esconde a senha da URL', () => {
    expect(_mascarar('http://joao:segredo@1.2.3.4:80')).not.toContain('segredo');
  });

  test('proxy sem senha continua legível', () => {
    expect(_mascarar('http://1.2.3.4:80')).toBe('http://1.2.3.4:80');
  });

  test('valor inválido não quebra', () => {
    expect(_mascarar('nao e url')).toBe('nao e url');
  });
});

describe('listarAtribuicoes — aponta o que ainda está errado', () => {
  let findOriginal;
  beforeEach(() => { findOriginal = Account.find; });
  afterEach(() => { Account.find = findOriginal; });

  test('conta o que está sem proxy e acusa IP compartilhado', async () => {
    Account.find = jest.fn(() => ({
      select: () => ({ lean: async () => [
        { _id: 'a', username: 'c1', proxy: 'http://1.1.1.1:80', proxyIp: '8.8.8.8' },
        { _id: 'b', username: 'c2', proxy: 'http://2.2.2.2:80', proxyIp: '8.8.8.8' },
        { _id: 'c', username: 'c3', proxy: '', proxyIp: '' },
      ] }),
    }));

    const r = await listarAtribuicoes();
    expect(r.semProxy).toBe(1);
    // Dois proxies diferentes saindo pelo mesmo IP é o alerta que importa.
    expect(r.ipsCompartilhados).toContainEqual({ ip: '8.8.8.8', contas: 2 });
  });

  test('senha do proxy não aparece na listagem', async () => {
    Account.find = jest.fn(() => ({
      select: () => ({ lean: async () => [
        { _id: 'a', username: 'c1', proxy: 'http://joao:segredo@1.1.1.1:80', proxyIp: '8.8.8.8' },
      ] }),
    }));

    const r = await listarAtribuicoes();
    expect(JSON.stringify(r)).not.toContain('segredo');
  });
});
