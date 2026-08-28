/**
 * Reserva de proxy no momento da conexão.
 *
 * A regra que estes testes protegem: UM proxy, UMA conta, nunca compartilhado.
 * Duas contas saindo pelo mesmo IP é o sinal de automação que o pool existe
 * para eliminar — recriá-lo por acidente seria pior que não ter pool, porque
 * daria a impressão de estar resolvido.
 *
 * O modelo é substituído por um duplê em memória, como no resto da suíte. A
 * atomicidade em si é garantia do MongoDB, não do nosso código; o que cabe a
 * nós é USAR uma operação atômica em vez de ler-modificar-gravar, e isso o
 * último teste verifica pela forma da chamada.
 */

/* Prefixo `mock` obrigatório: o Jest recusa fábrica de `jest.mock()` que
   referencie variável de fora do escopo, e abre exceção só para nomes com
   esse prefixo — é a proteção dele contra usar uma variável ainda não
   inicializada no momento em que a fábrica roda. */
const mockRegistros = [];
const mockChamadas = { findOneAndUpdate: 0, findOne: 0, updateOne: 0 };

function mockBate(doc, filtro) {
  return Object.entries(filtro).every(([campo, cond]) => {
    const v = doc[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$ne' in cond) return v !== cond.$ne;
      if ('$in' in cond)  return cond.$in.some(x => String(x) === String(v));
      if ('$nin' in cond) return !cond.$nin.some(x => String(x) === String(v));
    }
    return String(v ?? null) === String(cond ?? null);
  });
}

/* Contas que "existem" — `recuperarOrfaos` consulta o Account para decidir
   quais reservas ainda têm dono. É a única fonte da verdade dessa decisão:
   errá-la significa devolver ao pool um proxy em uso, ou nunca devolver
   nenhum. */
const mockContasVivas = [];

jest.mock('../src/models/Account', () => ({
  find: (filtro = {}) => ({
    select: () => ({
      lean: async () => {
        const ids = filtro._id?.$in;
        return mockContasVivas.filter(c => !ids || ids.some(i => String(i) === String(c._id)));
      },
    }),
  }),
}));

jest.mock('../src/models/ProxyPool', () => {
  const erroDuplicado = () => Object.assign(new Error('duplicate key'), { code: 11000 });
  return {
    async create(doc) {
      if (mockRegistros.some(r => r.url === doc.url)) throw erroDuplicado();
      /* `_id` não é enfeite: sem ele, uma consulta por `{ _id: { $in: [...] } }`
         casa com TODOS os registros, porque `undefined === undefined`. Foi o que
         aconteceu — o teste de órfãos recuperou dois proxies em vez de um. */
      const novo = { _id: `p${mockRegistros.length + 1}`,
                     contaId: null, ip: '', ok: null, rotativo: false, erro: '',
                     ultimoTeste: null, reservadoEm: null, createdAt: new Date(), ...doc };
      mockRegistros.push(novo);
      return novo;
    },
    findOne(filtro) {
      mockChamadas.findOne++;
      const achado = mockRegistros.find(r => mockBate(r, filtro)) || null;
      return { lean: async () => achado };
    },
    findOneAndUpdate(filtro, atualizacao) {
      mockChamadas.findOneAndUpdate++;
      const alvo = mockRegistros.find(r => mockBate(r, filtro));
      if (!alvo) return { lean: async () => null };
      Object.assign(alvo, atualizacao.$set);
      return { lean: async () => ({ ...alvo }) };
    },
    async updateOne(filtro, atualizacao) {
      mockChamadas.updateOne++;
      const alvo = mockRegistros.find(r => mockBate(r, filtro));
      if (alvo) Object.assign(alvo, atualizacao.$set);
      return { modifiedCount: alvo ? 1 : 0 };
    },
    async updateMany(filtro, atualizacao) {
      const alvos = mockRegistros.filter(r => mockBate(r, filtro));
      alvos.forEach(a => Object.assign(a, atualizacao.$set));
      return { modifiedCount: alvos.length };
    },
    async countDocuments(filtro = {}) {
      return mockRegistros.filter(r => mockBate(r, filtro)).length;
    },
    async deleteOne(filtro) {
      const i = mockRegistros.findIndex(r => mockBate(r, filtro));
      if (i >= 0) mockRegistros.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async deleteMany() { mockRegistros.length = 0; return { deletedCount: 0 }; },
    find(filtro = {}) {
      const achados = () => mockRegistros.filter(r => mockBate(r, filtro)).map(r => ({ ...r }));
      return {
        select:   () => ({ lean: async () => achados() }),
        populate: () => ({ sort: () => ({ lean: async () => achados() }) }),
        lean: async () => achados(),
      };
    },
  };
});

/* `reservar` recusa consultar quando o Mongoose não está conectado — sem essa
   guarda, uma instabilidade do Mongo travaria cada login por 10s enquanto a
   consulta fica enfileirada.
   
   Aqui o modelo é um duplê e não há conexão de verdade. Substituir o mongoose
   inteiro não serve: os modelos que a cadeia carrega precisam de Schema real
   (`accountSchema.index` não existe num dublê). Sobrescrevemos então só o
   estado da conexão, deixando o resto da biblioteca intacto. */
const pool = require('../src/services/proxyPool');

/* Aqui o modelo é um duplê e não há conexão real. `bancoConectado` existe
   como costura justamente para isto: substituir o mongoose inteiro quebraria
   os modelos que a cadeia carrega, que precisam de Schema de verdade. */
pool.bancoConectado = () => true;

let seq = 0;
const conta = () => `conta${++seq}`;

beforeEach(() => {
  mockRegistros.length = 0;
  mockContasVivas.length = 0;
  mockChamadas.findOneAndUpdate = 0;
  mockChamadas.findOne = 0;
  mockChamadas.updateOne = 0;
});

describe('importação', () => {
  test('aceita o formato do fornecedor com geolocalização no usuário', async () => {
    const r = await pool.importar(
      'host.axtron.io:11000:cliente__cr.br;state.saopaulo;city.adamantina:senha\n' +
      'host.axtron.io:11001:cliente__cr.br;state.saopaulo;city.adamantina:senha'
    );
    expect(r.adicionados).toBe(2);
    expect(r.invalidas).toHaveLength(0);
  });

  test('proxy repetido não entra duas vezes', async () => {
    await pool.importar('1.2.3.4:8080\n1.2.3.4:8080');
    expect(mockRegistros).toHaveLength(1);
  });

  test('reimportar a mesma lista não duplica nem falha', async () => {
    await pool.importar('1.2.3.4:8080\n5.6.7.8:9090');
    const r = await pool.importar('1.2.3.4:8080\n5.6.7.8:9090');
    expect(r.adicionados).toBe(0);
    expect(r.jaExistiam).toBe(2);
    expect(mockRegistros).toHaveLength(2);
  });
});

describe('reserva', () => {
  test('cada conta recebe um proxy diferente', async () => {
    await pool.importar('1.1.1.1:80\n2.2.2.2:80\n3.3.3.3:80');
    const r = [await pool.reservar(conta()), await pool.reservar(conta()), await pool.reservar(conta())];
    expect(new Set(r).size).toBe(3);
  });

  test('a mesma conta recebe sempre o mesmo, sem consumir outro', async () => {
    // Reconectar é comum. Se cada reconexão gastasse um proxy, o pool
    // esvaziaria por engano.
    await pool.importar('1.1.1.1:80\n2.2.2.2:80');
    const id = conta();
    const primeira = await pool.reservar(id);
    expect(await pool.reservar(id)).toBe(primeira);
    expect(mockRegistros.filter(r => r.contaId === null)).toHaveLength(1);
  });

  test('pool esgotado devolve null, não um proxy compartilhado', async () => {
    // O ponto inteiro: preferimos a conexão falhar com explicação a ter duas
    // contas dividindo IP em silêncio.
    await pool.importar('1.1.1.1:80');
    expect(await pool.reservar(conta())).toBeTruthy();
    expect(await pool.reservar(conta())).toBeNull();
  });

  test('proxy reprovado no teste não é reservado', async () => {
    // Trocar "conta saindo pelo IP errado" por "conta que não conecta" é
    // piorar.
    await pool.importar('1.1.1.1:80\n2.2.2.2:80');
    mockRegistros[0].ok = false;
    expect(await pool.reservar(conta())).toBe('http://2.2.2.2:80');
  });

  test('proxy rotativo não é reservado', async () => {
    // O login são várias requisições em sequência; se o IP muda no meio, o
    // Instagram vê a sessão nascendo espalhada e recusa.
    await pool.importar('1.1.1.1:80\n2.2.2.2:80');
    mockRegistros[0].rotativo = true;
    expect(await pool.reservar(conta())).toBe('http://2.2.2.2:80');
  });

  test('proxy nunca testado continua elegível', async () => {
    // Recusar o não testado deixaria o pool inutilizável logo após a
    // importação, que é justamente quando ele é usado.
    await pool.importar('1.1.1.1:80');
    expect(await pool.reservar(conta())).toBe('http://1.1.1.1:80');
  });

  test('reserva usa UMA operação atômica, não ler-modificar-gravar', async () => {
    // A garantia real contra duas contas receberem o mesmo proxy. Com
    // findOne seguido de updateOne, duas conexões simultâneas leriam o mesmo
    // registro livre antes de qualquer uma gravar — e as duas levariam o
    // mesmo IP. Este teste falha se alguém trocar a operação atômica por
    // uma sequência.
    await pool.importar('1.1.1.1:80');
    mockChamadas.findOneAndUpdate = 0;
    mockChamadas.updateOne = 0;

    await pool.reservar(conta());

    expect(mockChamadas.findOneAndUpdate).toBe(1);
    expect(mockChamadas.updateOne).toBe(0);
  });
});

describe('devolução', () => {
  test('liberar devolve o proxy ao pool', async () => {
    await pool.importar('1.1.1.1:80');
    const id = conta();
    await pool.reservar(id);
    expect(await pool.reservar(conta())).toBeNull();

    await pool.liberar(id);
    expect(await pool.reservar(conta())).toBe('http://1.1.1.1:80');
  });

  test('liberar conta sem proxy não quebra', async () => {
    expect(await pool.liberar(conta())).toBe(0);
  });
});

describe('resumo', () => {
  test('separa livres, reservados, reprovados e rotativos', async () => {
    await pool.importar('1.1.1.1:80\n2.2.2.2:80\n3.3.3.3:80\n4.4.4.4:80');
    mockRegistros[2].ok = false;
    mockRegistros[3].rotativo = true;
    await pool.reservar(conta());

    const r = await pool.resumo();
    expect(r).toMatchObject({ total: 4, livres: 1, reservados: 1, ruins: 1, rotativos: 1 });
  });
});

describe('reservas órfãs', () => {
  /* Uma conta apagada por um caminho que não chama `liberar()` deixa o proxy
     reservado para sempre: o pool encolhe em silêncio até esgotar, e a tela
     ainda se contradizia — o resumo somava "em uso" enquanto a tabela mostrava
     "livre", porque `populate` de referência morta devolve null. */

  test('devolve ao pool o proxy de uma conta que não existe mais', async () => {
    await pool.importar('1.1.1.1:80\n2.2.2.2:80');
    mockRegistros[0].contaId = 'viva';
    mockRegistros[1].contaId = 'apagada';
    mockContasVivas.push({ _id: 'viva' });

    expect(await pool.recuperarOrfaos()).toEqual({ recuperados: 1 });
    expect(mockRegistros[0].contaId).toBe('viva');   // reserva legítima intacta
    expect(mockRegistros[1].contaId).toBeNull();     // órfã devolvida
  });

  test('proxy livre não é confundido com órfão', async () => {
    // Se o filtro do `find` fosse ignorado, o pool inteiro entraria na conta.
    await pool.importar('1.1.1.1:80\n2.2.2.2:80');
    mockRegistros[0].contaId = 'viva';
    mockContasVivas.push({ _id: 'viva' });

    expect(await pool.recuperarOrfaos()).toEqual({ recuperados: 0 });
    expect(mockRegistros[1].contaId).toBeNull();
  });

  test('sem reserva nenhuma, não faz nada', async () => {
    await pool.importar('1.1.1.1:80');
    expect(await pool.recuperarOrfaos()).toEqual({ recuperados: 0 });
  });

  test('banco fora do ar não apaga reserva', async () => {
    // Sem esta guarda, uma queda do Mongo faria `Account.find` devolver vazio
    // e TODAS as reservas seriam lidas como órfãs.
    await pool.importar('1.1.1.1:80');
    mockRegistros[0].contaId = 'viva';

    const antes = pool.bancoConectado;
    pool.bancoConectado = () => false;
    expect(await pool.recuperarOrfaos()).toEqual({ recuperados: 0, motivo: 'sem banco' });
    pool.bancoConectado = antes;

    expect(mockRegistros[0].contaId).toBe('viva');
  });
});
