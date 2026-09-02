import { describe, test, expect } from 'vitest';
import { criarPedido, decidirEmenda, PRAZO_MS } from './emendaMobile.js';

/**
 * A emenda entre a conexão oficial e a API Mobile.
 *
 * ── Por que estes testes existem
 *
 * A primeira versão desta funcionalidade foi entregue sem funcionar, e o
 * defeito só apareceu quando o usuário tentou: existem três caminhos que
 * completam a conexão oficial e a emenda estava ligada em um só.
 *
 * A lógica morava dentro de um `useEffect` de um componente de 2.000 linhas —
 * não havia como verificá-la sem montar a página e autenticar, e por isso ela
 * foi para produção sem nunca ter sido executada. Aqui ela é chamável sozinha.
 */

const CONTAS = [
  { _id: 'a1', username: 'wendykovaleski175', hasInstagrapiSession: false },
  { _id: 'a2', username: 'luanabrandelli',    hasInstagrapiSession: true  },
];

describe('criar o pedido', () => {
  test('tira o @ e os espaços', () => {
    /* O toast escreve "@fulano", e é fácil o mesmo texto chegar aqui com o
       arroba junto. Comparado cru contra a lista, que guarda sem arroba,
       nenhuma conta bateria — e o sintoma seria "não apareceu nada". */
    expect(criarPedido('  @wendykovaleski175 ').username).toBe('wendykovaleski175');
  });

  test('sem username não há pedido', () => {
    for (const v of ['', '   ', '@', null, undefined]) {
      expect(criarPedido(v)).toBeNull();
    }
  });

  test('nasce com prazo', () => {
    expect(criarPedido('x', 1000).ate).toBe(1000 + PRAZO_MS);
  });
});

describe('decidir o que fazer', () => {
  const pedido = (u, ate = Date.now() + PRAZO_MS) => ({ username: u, ate });

  test('conta na lista e sem sessão mobile: abre', () => {
    const r = decidirEmenda(pedido('wendykovaleski175'), CONTAS);
    expect(r.acao).toBe('abrir');
    expect(r.conta._id).toBe('a1');
  });

  test('conta que já tem sessão mobile: não pede nada', () => {
    /* Pedir a senha de quem já está conectado é ruído — e pior, sugere que a
       conexão anterior não valeu. */
    expect(decidirEmenda(pedido('luanabrandelli'), CONTAS).acao).toBe('ja-tem');
  });

  test('conta ainda não chegou na lista: espera', () => {
    /* A lista vem de uma requisição assíncrona. Decidir antes dela chegar
       abriria o modal sem `_id`, e o login criaria uma conta duplicada em vez
       de completar a que acabou de ser conectada. */
    expect(decidirEmenda(pedido('novaconta'), CONTAS).acao).toBe('esperar');
    expect(decidirEmenda(pedido('novaconta'), []).acao).toBe('esperar');
  });

  test('passou do prazo: desiste, mesmo com a conta na lista', () => {
    /* O prazo vem antes da busca de propósito. Sem isso, um @ que aparecesse
       meia hora depois — outra pessoa cadastrando a mesma conta — faria o
       modal pular do nada, sem relação com nada que se estivesse fazendo. */
    const vencido = pedido('wendykovaleski175', Date.now() - 1);
    expect(decidirEmenda(vencido, CONTAS).acao).toBe('desistir');
  });

  test('compara sem caixa e sem @ dos dois lados', () => {
    /* O backend devolve o @ como o Instagram o grafa; a lista guarda em
       minúsculas. Comparar cru erraria em qualquer conta com maiúscula. */
    const contas = [{ _id: 'b1', username: '@WendyKovaleski175', hasInstagrapiSession: false }];
    expect(decidirEmenda(pedido('wendykovaleski175'), contas).acao).toBe('abrir');
  });

  test('sem pedido não faz nada', () => {
    expect(decidirEmenda(null, CONTAS).acao).toBe('nada');
    expect(decidirEmenda({ username: '' }, CONTAS).acao).toBe('nada');
  });

  test('lista inválida não quebra', () => {
    /* `accounts` começa como o que estiver no localStorage, e já veio como
       objeto em vez de lista em bugs anteriores desta base. */
    expect(decidirEmenda(pedido('x'), null).acao).toBe('esperar');
    expect(decidirEmenda(pedido('x'), { nao: 'e lista' }).acao).toBe('esperar');
  });

  test('conta sem username na lista não derruba a busca', () => {
    const contas = [{ _id: 'z' }, ...CONTAS];
    expect(decidirEmenda(pedido('wendykovaleski175'), contas).acao).toBe('abrir');
  });
});
