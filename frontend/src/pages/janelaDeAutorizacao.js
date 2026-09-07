/**
 * A janela de autorização da API oficial.
 *
 * ── Por que isto é um módulo, e não código dentro do componente
 *
 * A mesma razão do `emendaMobile.js`: o que mora dentro de um `useEffect` de
 * uma página de 2.700 linhas não tem como ser verificado sem montar a página e
 * autenticar. E aqui há um detalhe que nenhum clique na tela alcança — a janela
 * de autorização é bloqueada em ambiente de teste, então o caminho do popup só
 * é executável se a decisão estiver separada da janela.
 *
 * ── O que a janela resolve
 *
 * Conectar muitas contas seguidas. Navegando a própria aba, a tela de contas é
 * descarregada a cada conta: some a lista, o filtro e a rolagem, e é preciso
 * voltar e recomeçar. Com a janela, a tela de trás nunca sai do lugar.
 *
 * O preço é que o retorno cai DENTRO da janela. Daí as duas metades deste
 * módulo: a janela precisa saber que é janela (para avisar e se fechar em vez
 * de navegar), e a tela de trás precisa saber o que aceitar do que chega.
 */

/** O que a janela manda para quem a abriu. Combinado dos dois lados. */
export const TIPO_DE_AVISO = 'mf_oauth';

/** Quanto tempo o mesmo @ fica sem poder gerar um segundo aviso. */
export const PRAZO_DE_REPETICAO_MS = 8_000;

/** O maior @ que o Instagram emite. Recorta o que chega de fora. */
const MAX_ARROBA = 30;

/**
 * Esta página está numa janela aberta por outra, ou na própria aba?
 *
 * Decidido UMA vez, no início do fluxo, e nunca reconsultado: se a janela se
 * fechar no meio do caminho, `window.opener` passa a responder diferente e o
 * desfecho iria para a navegação — dentro de uma janela já morta.
 *
 * O `try` existe porque acessar `opener.closed` pode lançar quando a janela de
 * origem é de outra origem. Nesse caso não há aviso possível, então tratar como
 * aba comum é a resposta certa.
 *
 * @param {Window} [win]
 */
export function ehJanela(win = typeof window !== 'undefined' ? window : undefined) {
  try { return !!win?.opener && !win.opener.closed; } catch { return false; }
}

/**
 * O aviso que chegou é aproveitável?
 *
 * Devolve `null` para tudo que deve ser ignorado em silêncio — é a fronteira de
 * confiança desta tela. Sem a conferência de origem, qualquer página que
 * conseguisse uma referência a esta poderia anunciar uma conta conectada que
 * não existe, e a lista de contas passaria a mostrar o que o invasor escreveu.
 *
 * O @ é recortado em {@link MAX_ARROBA} porque vai para dentro de um texto na
 * tela: o Instagram nunca emite mais que isso, então o que passa disso não é
 * um @ e não merece espaço.
 *
 * @param {{origin?: string, data?: any}} ev — o MessageEvent
 * @param {string} origemEsperada — normalmente `window.location.origin`
 * @returns {{ok: boolean, username: string, erro: string}|null}
 */
export function lerAviso(ev, origemEsperada) {
  if (!ev || typeof origemEsperada !== 'string' || !origemEsperada) return null;
  /* Comparação exata de string, e não `includes`: "https://instaflow.pro.mau.site"
     contém "https://instaflow.pro" e passaria. */
  if (ev.origin !== origemEsperada) return null;

  const d = ev.data;
  /* Só objeto simples. Um array tem `d.tipo === undefined` e já cairia fora,
     mas dizer isto aqui evita depender desse acidente. */
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.tipo !== TIPO_DE_AVISO) return null;

  const ok = d.ok === true;
  return {
    ok,
    username: typeof d.username === 'string' ? d.username.trim().slice(0, MAX_ARROBA) : '',
    erro: !ok && typeof d.erro === 'string' ? d.erro.slice(0, 200) : '',
  };
}

/**
 * Este @ merece um aviso na tela agora?
 *
 * A conta que entra pela janela chega por dois caminhos ao mesmo tempo: a
 * janela manda o aviso antes de fechar, e o servidor transmite pelo SSE. Os
 * dois são desejáveis — o aviso é imediato e traz o @, o SSE cobre a janela
 * fechada na mão ou a autorização feita em outro navegador. O que não pode é a
 * mesma conexão virar dois avisos.
 *
 * A memória é por @ e por TEMPO, não um "já avisei" permanente: reconectar a
 * mesma conta meia hora depois é evento novo e merece o próprio aviso.
 *
 * Não grava nada — quem chama decide registrar, e é o registro que fecha a
 * janela de repetição.
 *
 * @param {Map<string, number>} mapa — @ em minúscula → instante do último aviso
 * @param {string} username
 * @param {number} agora
 * @param {number} [prazoMs]
 */
export function deveAnunciar(mapa, username, agora, prazoMs = PRAZO_DE_REPETICAO_MS) {
  const chave = chaveDoArroba(username);
  const visto = mapa?.get?.(chave);
  if (typeof visto !== 'number') return true;
  return agora - visto >= prazoMs;
}

/**
 * A chave pela qual dois avisos são "o mesmo @".
 *
 * Minúscula porque o Instagram não diferencia caixa: o SSE pode trazer "Fulano"
 * e a janela "fulano", e sem isto os dois virariam dois avisos da mesma coisa.
 */
export function chaveDoArroba(username) {
  return String(username ?? '').trim().toLowerCase();
}
