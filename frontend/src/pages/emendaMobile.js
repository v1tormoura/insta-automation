/**
 * A decisão de pedir a API Mobile logo depois da conexão oficial.
 *
 * ── Por que está aqui fora
 *
 * Ela vivia dentro de um `useEffect` de um componente de 2.000 linhas, e por
 * isso não tinha como ser testada sem montar a página inteira e autenticar.
 * O resultado foi entregar uma versão que não funcionava e só descobrir pela
 * tela — que é a forma mais cara de descobrir.
 *
 * ── O defeito que motivou a extração
 *
 * Existem TRÊS caminhos que completam a conexão oficial: o redirecionamento
 * da Meta, colar a URL de retorno, e conectar por token. A primeira versão
 * ligou a emenda só no primeiro. Quem usou os outros dois via a conta conectar
 * e o fluxo acabar ali, sem nada acontecer.
 *
 * ── Por que ela espera em vez de decidir na hora
 *
 * O modal precisa do `_id` da conta para saber onde gravar a sessão, e a lista
 * chega por uma requisição assíncrona. Decidir antes dela chegar abriria o
 * modal sem conta — e o login criaria uma conta duplicada em vez de completar
 * a que acabou de ser conectada.
 */

/** Quanto tempo o pedido fica de pé esperando a conta aparecer na lista. */
export const PRAZO_MS = 60_000;

/**
 * @param {string} username
 * @param {number} [agora]
 * @returns {{username: string, ate: number}|null} o pedido, ou null se não há o que pedir
 */
export function criarPedido(username, agora = Date.now()) {
  const uname = String(username || '').trim().replace(/^@/, '');
  if (!uname) return null;
  return { username: uname, ate: agora + PRAZO_MS };
}

/**
 * O que fazer com um pedido pendente, dada a lista de contas conhecida agora.
 *
 * @returns {{acao: 'nada'}}              — não há pedido
 *        | {{acao: 'esperar'}}           — a conta ainda não chegou na lista
 *        | {{acao: 'desistir'}}          — passou do prazo
 *        | {{acao: 'ja-tem', conta}}     — a conta já tem sessão mobile
 *        | {{acao: 'abrir', conta}}      — abrir o modal para esta conta
 */
export function decidirEmenda(pedido, contas, agora = Date.now()) {
  if (!pedido || !pedido.username) return { acao: 'nada' };

  /* O prazo é conferido ANTES da busca. Sem isso, um @ que só aparecesse meia
     hora depois — outra pessoa cadastrando a mesma conta, por exemplo — faria
     o modal pular do nada, sem relação com nada que se estivesse fazendo. */
  if (agora > pedido.ate) return { acao: 'desistir' };

  const lista = Array.isArray(contas) ? contas : [];
  const alvo = pedido.username.toLowerCase();

  /* Compara sem o "@" e sem caixa: o backend devolve o @ como o Instagram o
     grafa, e a lista guarda em minúsculas. Comparar cru erraria em qualquer
     conta com maiúscula no nome. */
  const conta = lista.find(
    c => String(c?.username || '').trim().replace(/^@/, '').toLowerCase() === alvo
  );

  if (!conta) return { acao: 'esperar' };
  if (conta.hasInstagrapiSession) return { acao: 'ja-tem', conta };
  return { acao: 'abrir', conta };
}
