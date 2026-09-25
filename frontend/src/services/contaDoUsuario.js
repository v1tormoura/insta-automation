/**
 * O topo do painel mostra o nome e a foto de quem está logado. Quando eles
 * mudam em Minha Conta, a página avisa por este evento e o topo relê `/conta`
 * — sem isto, o topo continuava com o que leu ao abrir o painel.
 */
const EVENTO = 'conta-do-usuario-mudou';

export function avisarTopo() {
  window.dispatchEvent(new Event(EVENTO));
}

export function aoMudarConta(fn) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
