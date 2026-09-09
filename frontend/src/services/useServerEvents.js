import { useEffect, useRef } from 'react';
import { getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Eventos do servidor (SSE), numa conexão ÚNICA compartilhada.
 *
 * ── O defeito que isto conserta
 *
 * Cada chamada do hook abria o seu próprio `EventSource`. Quinze telas o usam,
 * e no painel havia CINCO componentes montados ao mesmo tempo — MainLayout,
 * SmartActivity, Dashboard, ConnectedAccountsMetrics e FilaDePostagens — logo,
 * cinco conexões permanentes para o mesmo `/events`.
 *
 * Em HTTP/1.1 o navegador permite SEIS conexões simultâneas por origem, e SSE
 * segura a conexão aberta para sempre. Com cinco presas, sobrava UMA vaga para
 * todo o resto: dashboard, account-stats, insights, loops, global-metrics,
 * /conta, notificações. E como o painel se recarrega a cada 15 segundos, a
 * fila nunca drenava.
 *
 * O sintoma não parecia de rede: uma seção do painel ficava girando para
 * sempre, sem erro nenhum no console — a requisição não falhava, ela nunca
 * saía. As outras funcionavam, o que afastava a suspeita de conexão. Foi
 * medindo a aba de rede que apareceu: várias requisições pendentes e uma só
 * respondida.
 *
 * Vale em produção pelo mesmo motivo: o nginx do projeto escuta `443 ssl` sem
 * `http2`, então o teto de seis é o mesmo lá.
 *
 * ── Por que uma conexão só basta
 *
 * O servidor transmite os MESMOS eventos para todos os inscritos. Cinco
 * conexões recebiam cinco cópias de cada evento — desperdício também do lado
 * do servidor, que fazia cinco escritas por broadcast. Aqui a conexão é uma, e
 * a distribuição acontece neste módulo.
 *
 * ── Por que o registro é por NOME de evento
 *
 * Assim um componente inscrito em `['posts']` não é acordado por `insights`.
 * Distribuir tudo para todos funcionaria e faria cada componente do painel
 * recarregar a cada evento de qualquer tipo.
 */

/* ── O estado do módulo ──────────────────────────────────────────────────── */

let fonte = null;              // o EventSource, ou null
let tokenDaFonte = null;       // com qual token ele foi aberto
let tentativaId = null;        // timer de reconexão
let tentativas = 0;            // para o recuo progressivo

/** `{ eventos: string[], cb: React.MutableRefObject<Function> }` */
const inscritos = new Set();

/** Quais nomes de evento alguém está ouvindo agora. */
function nomesOuvidos() {
  const nomes = new Set();
  for (const i of inscritos) for (const n of i.eventos) nomes.add(n);
  return nomes;
}

function entregar(nome, dados) {
  for (const i of inscritos) {
    if (!i.eventos.includes(nome)) continue;
    try {
      i.cb.current?.(dados, nome);
    } catch (err) {
      /* Um assinante que estoura não pode impedir os outros de receber o
         mesmo evento — senão a ordem de inscrição passa a decidir quem é
         notificado, o que é impossível de depurar. */
      console.warn('[SSE] assinante falhou em', nome, err);
    }
  }
}

function fechar() {
  if (tentativaId) { clearTimeout(tentativaId); tentativaId = null; }
  if (fonte) { fonte.close(); fonte = null; }
  tokenDaFonte = null;
}

function abrir(retryMs) {
  if (!inscritos.size) return;          // ninguém ouvindo: não abre
  if (fonte) return;                    // já aberta

  const token = getToken();
  try {
    const es = new EventSource(`${API_BASE}/events${token ? `?token=${token}` : ''}`);
    fonte = es;
    tokenDaFonte = token;

    /* Os handlers são registrados para TODOS os nomes ouvidos no momento da
       abertura. Uma inscrição que aparece depois chama `garantirNomes`, que
       adiciona só o que falta. */
    for (const nome of nomesOuvidos()) registrarNome(es, nome);

    es.onopen = () => {
      tentativas = 0;
      if (tentativaId) { clearTimeout(tentativaId); tentativaId = null; }
    };

    es.onerror = () => {
      es.close();
      if (fonte === es) fonte = null;
      if (!inscritos.size) return;

      /* Recuo progressivo com teto. A versão anterior reconectava a cada 2 s
         para sempre: com o backend fora do ar, isso era uma requisição a cada
         2 segundos POR COMPONENTE, indefinidamente. */
      tentativas = Math.min(tentativas + 1, 6);
      const espera = Math.min(retryMs * 2 ** (tentativas - 1), 30_000);
      if (tentativaId) clearTimeout(tentativaId);
      tentativaId = setTimeout(() => { tentativaId = null; abrir(retryMs); }, espera);
    };
  } catch {
    /* SSE indisponível. Tenta de novo, com o mesmo recuo. */
    fonte = null;
    tentativas = Math.min(tentativas + 1, 6);
    const espera = Math.min(retryMs * 2 ** (tentativas - 1), 30_000);
    if (tentativaId) clearTimeout(tentativaId);
    tentativaId = setTimeout(() => { tentativaId = null; abrir(retryMs); }, espera);
  }
}

/* Quais nomes já têm handler nesta conexão. `WeakSet` por conexão para o
   registro morrer junto com ela. */
const nomesRegistrados = new WeakMap();

function registrarNome(es, nome) {
  let jaTem = nomesRegistrados.get(es);
  if (!jaTem) { jaTem = new Set(); nomesRegistrados.set(es, jaTem); }
  if (jaTem.has(nome)) return;
  jaTem.add(nome);

  es.addEventListener(nome, (e) => {
    let dados = {};
    try { dados = e.data ? JSON.parse(e.data) : {}; } catch { dados = {}; }
    entregar(nome, dados);
  });
}

/** Garante handler para os nomes de um assinante recém-chegado. */
function garantirNomes(eventos) {
  if (!fonte) return;
  for (const nome of eventos) registrarNome(fonte, nome);
}

/**
 * Escuta eventos do servidor.
 *
 * A assinatura é a mesma de antes — quinze telas dependem dela.
 *
 * @param {string[]} events   nomes dos eventos (ex: ['posts', 'accounts'])
 * @param {function} callback chamada quando qualquer um deles ocorrer
 * @param {{retryMs?: number}} [options]
 */
export function useServerEvents(events, callback, { retryMs = 2000 } = {}) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  /* Os nomes entram numa ref para o efeito não depender de um array novo a
     cada render — `['posts']` literal no JSX é outro array em cada passagem, e
     como dependência ele reabriria a inscrição a cada render. */
  const nomesRef = useRef(events);
  nomesRef.current = events;
  const chave = Array.isArray(events) ? events.join(',') : String(events || '');

  useEffect(() => {
    const inscricao = { eventos: nomesRef.current || [], cb: cbRef };
    inscritos.add(inscricao);

    /* Token trocado desde que a conexão abriu (login, ou troca de conta):
       reabre, senão o servidor segue autenticando o antigo. */
    if (fonte && tokenDaFonte !== getToken()) fechar();

    abrir(retryMs);
    garantirNomes(inscricao.eventos);

    return () => {
      inscritos.delete(inscricao);
      /* A última saída apaga a luz. Sem isto, a conexão sobreviveria ao logout
         e continuaria autenticada com o token de quem saiu. */
      if (!inscritos.size) fechar();
    };
  }, [chave, retryMs]);
}

export default useServerEvents;
