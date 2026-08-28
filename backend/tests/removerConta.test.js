/**
 * Remoção de conta — a devolução do proxy é a parte que se esquece.
 *
 * O vazamento que estes testes protegem não é hipotético. Uma conta que usa o
 * pool tem um proxy RESERVADO em nome dela; apagar a conta sem liberar deixa a
 * reserva apontando para um dono inexistente, e aquela entrada nunca mais é
 * oferecida a ninguém.
 *
 * O que torna isso difícil de achar é a distância entre causa e efeito. O pool
 * encolhe de um em um, em silêncio. Meses depois, sem proxy livre, as contas
 * caem no proxy global e várias saem pelo mesmo IP — e o sintoma que aparece é
 * "o Instagram acha que é automação", que não se parece em nada com "uma
 * tentativa de login falhou em março".
 *
 * O caminho mais caro era justamente o menos óbvio: as rotas de conexão criam
 * uma conta temporária e a apagam se o login falhar. O login, para acontecer,
 * já reservou um proxy. Cada tentativa malsucedida custava um proxy permanente.
 */

const { readFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

const mockContas = [];
const mockLiberados = [];
let mockLiberarFalha = null;

jest.mock('../src/models/Account', () => ({
  async deleteOne(filtro) {
    const i = mockContas.findIndex(c => String(c._id) === String(filtro._id));
    if (i < 0) return { deletedCount: 0 };
    mockContas.splice(i, 1);
    return { deletedCount: 1 };
  },
}));

jest.mock('../src/services/proxyPool', () => ({
  async liberar(id) {
    if (mockLiberarFalha) throw new Error(mockLiberarFalha);
    mockLiberados.push(String(id));
    return 1;
  },
}));

const removerConta = require('../src/utils/removerConta');

beforeEach(() => {
  mockContas.length = 0;
  mockLiberados.length = 0;
  mockLiberarFalha = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('remoção', () => {
  test('devolve o proxy e apaga a conta', async () => {
    mockContas.push({ _id: 'c1' });
    const r = await removerConta('c1');

    expect(r).toEqual({ removida: true, proxiesLiberados: 1 });
    expect(mockLiberados).toEqual(['c1']);
    expect(mockContas).toHaveLength(0);
  });

  test('libera ANTES de apagar', async () => {
    // Depois de apagada não há como descobrir qual reserva era dela: a entrada
    // do pool guarda o id da conta, e o id deixou de existir.
    mockContas.push({ _id: 'c1' });
    let contaAindaExistiaAoLiberar = null;

    const pool = require('../src/services/proxyPool');
    jest.spyOn(pool, 'liberar').mockImplementation(async (id) => {
      contaAindaExistiaAoLiberar = mockContas.some(c => c._id === String(id));
      return 1;
    });

    await removerConta('c1');
    expect(contaAindaExistiaAoLiberar).toBe(true);
  });

  test('pool fora do ar não impede a remoção', async () => {
    // Uma conta que o usuário mandou apagar precisa sumir mesmo assim. A
    // reserva órfã que sobrar é recuperada ao abrir a tela de Proxies.
    mockContas.push({ _id: 'c1' });
    mockLiberarFalha = 'mongo indisponível';

    const r = await removerConta('c1');
    expect(r.removida).toBe(true);
    expect(mockContas).toHaveLength(0);
  });

  test('id ausente não apaga nada', async () => {
    mockContas.push({ _id: 'c1' });
    expect(await removerConta(null)).toEqual({ removida: false, motivo: 'sem id' });
    expect(mockContas).toHaveLength(1);
  });

  test('conta inexistente não quebra', async () => {
    expect((await removerConta('sumiu')).removida).toBe(false);
  });
});

describe('nenhum outro caminho apaga conta', () => {
  /* Esta é a proteção que importa a longo prazo. Os testes acima provam que o
     helper libera o proxy; este prova que ninguém apaga uma conta SEM passar
     por ele — que é como o vazamento nasceu, com duas rotas chamando o modelo
     direto enquanto o controller fazia certo. Corrigir as duas sem travar a
     regra só adia a próxima. */
  const raiz = join(__dirname, '..', 'src');

  const arquivos = (dir) => readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.js') ? [p] : [];
  });

  test('só removerConta.js chama delete no modelo Account', () => {
    const proibido = /Account\s*\.\s*(deleteOne|deleteMany|findByIdAndDelete|findOneAndDelete)/;
    const infratores = [];

    for (const arq of arquivos(raiz)) {
      if (arq.endsWith(join('utils', 'removerConta.js'))) continue;
      const linhas = readFileSync(arq, 'utf8').split('\n');
      linhas.forEach((linha, i) => {
        // Comentário citando o nome não conta — o helper explica a si mesmo.
        const semComentario = linha.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (proibido.test(semComentario)) {
          infratores.push(`${arq.slice(raiz.length + 1)}:${i + 1}`);
        }
      });
    }

    expect(infratores).toEqual([]);
  });
});
