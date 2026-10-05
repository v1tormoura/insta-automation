import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, X, TrendingUp, Flame, Eye, Award, Info, AlertTriangle, CheckCheck, Check, Trash2, Settings } from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { ContextoSmartActivity, useSmartActivity, EVENTO_CONFIG } from '../services/smartActivityContexto';
import { notificacaoDoNavegador } from '../services/notificacaoNavegador';
import { urlDoAvatar } from '../utils/avatar';
import { useNotifications, markRead as marcarEfemerasLidas } from '../services/useNotifications';

/**
 * Smart Activity — avisos de marco e a Central de Notificações.
 *
 * ── Por que o cartão é o mesmo nos dois lugares
 *
 * O aviso que entra pelo topo e a linha do histórico são a MESMA notificação
 * vista em dois momentos. Desenhá-los separadamente garantiria que um dia
 * divergissem — e a pessoa que viu o aviso passar não reconheceria o registro
 * dele na Central. `Cartao` serve aos dois, mudando só a densidade.
 *
 * ── Por que a fila existe
 *
 * Um ciclo de sincronização pode cruzar dez marcos de uma vez. Dez cartões
 * simultâneos não são dez avisos: são uma parede que ninguém lê e que cobre a
 * tela inteira. No máximo três ficam visíveis; o resto espera a vez.
 *
 * ── Por que o número sobe contando
 *
 * `1.024` aparecendo pronto é um dado. O mesmo número subindo de zero é um
 * acontecimento — e o assunto aqui é exatamente que algo aconteceu. A animação
 * dura menos de um segundo e respeita `prefers-reduced-motion`, onde o número
 * simplesmente aparece.
 */

/* ── Aparência por tema ─────────────────────────────────────────────────────
   O tema diz o que a notificação SIGNIFICA; a cor vem sempre do sistema, nunca
   de um hex local — senão o dia em que a paleta mudar, as notificações ficam
   para trás. */
const TEMAS = {
  story:       { icone: Eye,        cor: 'var(--mf-mod-contas)' },
  viral:       { icone: Flame,      cor: 'var(--mf-mod-campanhas)' },
  reach:       { icone: TrendingUp, cor: 'var(--mf-mod-metricas)' },
  milestone:   { icone: Award,      cor: 'var(--mf-primary-500)' },
  achievement: { icone: Award,      cor: 'var(--mf-mod-jobs)' },
  success:     { icone: CheckCheck, cor: 'var(--mf-success-500)' },
  warning:     { icone: AlertTriangle, cor: 'var(--mf-warning-500)' },
  info:        { icone: Info,       cor: 'var(--mf-info-500)' },
};
const temaDe = t => TEMAS[t] || TEMAS.milestone;
/* O número da métrica — nunca um dígito colado a um @ ("@fulano969"). */
const NUMERO_DA_METRICA = /(?<![\w@.])\d[\d.,]*/;
const TEMAS_DE_METRICA = new Set(['story', 'viral', 'reach', 'milestone', 'achievement']);

/**
 * "agora", "há 7m", "ontem".
 *
 * Calculado no cliente e não no servidor: uma notificação aberta às 14h que
 * diz "há 7m" continuaria dizendo "há 7m" às 18h se o texto viesse pronto do
 * backend. Aqui ele acompanha o relógio de quem está olhando.
 */
function quandoFoi(criadaEm) {
  if (!criadaEm) return 'agora';
  const ms = Date.now() - new Date(criadaEm).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/* ── Contador ───────────────────────────────────────────────────────────── */

/**
 * Sobe até o valor em pouco menos de um segundo.
 *
 * Usa `requestAnimationFrame` e não `setInterval`: o intervalo continua
 * disparando numa aba escondida, gastando bateria para animar um número que
 * ninguém está vendo. O rAF pausa sozinho.
 */
function Contador({ valor, duracao = 850 }) {
  const alvo = Number(String(valor).replace(/\D/g, '')) || 0;
  const [n, setN] = useState(alvo);
  const quadroRef = useRef(null);

  useEffect(() => {
    const menosMovimento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (menosMovimento || alvo < 10) { setN(alvo); return; }

    const inicio = performance.now();
    const passo = agora => {
      const t = Math.min(1, (agora - inicio) / duracao);
      // Desaceleração cúbica: rápido no começo, pousando devagar no valor.
      setN(Math.round(alvo * (1 - Math.pow(1 - t, 3))));
      if (t < 1) quadroRef.current = requestAnimationFrame(passo);
    };
    quadroRef.current = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadroRef.current);
  }, [alvo, duracao]);

  return <>{n.toLocaleString('pt-BR')}</>;
}

/* ── Cartão ─────────────────────────────────────────────────────────────── */

/**
 * O monograma da marca.
 *
 * Era um traço em SVG inline (um "M" desenhado à mão, de antes do rebrand) —
 * inline exatamente para acompanhar o tema, já que um SVG carregado como
 * arquivo não enxerga as variáveis CSS da página. A logo nova é uma
 * ilustração (fitas 3D, sombra, gradiente próprio) que não dá pra recriar em
 * traço fiel — e não precisa: ela já carrega a cor da marca sozinha, então
 * troca por ela mesma em vez de uma versão aproximada. */
function Monograma() {
  /* PREENCHE o slot, em vez de aparecer reduzido no meio dele.

     O arquivo tem fundo próprio — um quadrado arredondado escuro com o N
     aceso. Desenhado a 62% dentro de um contêiner que TAMBÉM é um quadrado
     arredondado, com tinta e anel por volta, o resultado era quadrado dentro
     de quadrado: em 38px isso lê como avatar quebrado, que é exatamente o
     que o monograma existia para evitar. Preenchendo, os dois viram um só. */
  return <img src="/nexora-icon.png?v=1" alt=""
    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function Avatar({ notificacao, tamanho = 38, redondo = false }) {
  const [falhou, setFalhou] = useState(false);
  const src = urlDoAvatar(notificacao.avatar);
  const { icone: Ico, cor } = temaDe(notificacao.tema);

  return (
    <span style={{
      width: tamanho, height: tamanho, borderRadius: redondo ? '50%' : 'var(--mf-r-md)', flexShrink: 0,
      position: 'relative', display: 'grid', placeItems: 'center', overflow: 'visible',
      background: `color-mix(in oklch, ${cor} 14%, var(--mf-surface-2))`,
      boxShadow: `0 0 0 1px color-mix(in oklch, ${cor} 30%, transparent)`,
    }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: redondo ? '50%' : 'var(--mf-r-md)',
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {/* Sem foto sincronizada, entra a MARCA — não as iniciais.
        
            Iniciais identificam a conta, mas o cartão já faz isso na linha de
            baixo, com o @ por extenso. Duas letras genéricas num quadrado
            colorido pareciam avatar quebrado; o monograma parece decisão. */}
        {src && !falhou
          ? <img src={src} alt="" onError={() => setFalhou(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Monograma />}
      </span>

      {/* O selo do tema fica FORA do recorte do avatar: dentro, ele seria
          cortado pelo canto arredondado e viraria uma meia-lua. */}
      <span style={{
        position: 'absolute', right: redondo ? -3 : -5, bottom: redondo ? -3 : -5,
        width: redondo ? 16 : 18, height: redondo ? 16 : 18, borderRadius: 'var(--mf-r-full)',
        display: 'grid', placeItems: 'center',
        background: cor, color: 'var(--mf-bg)',
        border: '2px solid var(--mf-surface-1)',
      }}>
        <Ico size={9} strokeWidth={2.8} />
      </span>
    </span>
  );
}

/**
 * O cartão. `compacto` é a versão da Central; solto, é o aviso que entra.
 *
 * O número da mensagem é extraído e destacado: a frase inteira em peso
 * uniforme faz o dado — que é o assunto — pesar o mesmo que a preposição.
 */
export function Cartao({ notificacao, onFechar, onAbrir, compacto = false }) {
  const { cor } = temaDe(notificacao.tema);
  const partes = useMemo(() => {
    const m = String(notificacao.mensagem || '');
    /* Só aviso de MÉTRICA destaca o número (e o anima): em "Fulano 2
       (fulano2@x.com) pediu acesso" o primeiro dígito é parte de um nome. */
    const numero = TEMAS_DE_METRICA.has(notificacao.tema) && m.match(NUMERO_DA_METRICA);
    if (!numero) return [{ t: m }];
    const i = numero.index;
    return [
      { t: m.slice(0, i) },
      { t: numero[0], destaque: true },
      { t: m.slice(i + numero[0].length) },
    ];
  }, [notificacao.mensagem, notificacao.tema]);

  return (
    <div
      onClick={onAbrir}
      role={onAbrir ? 'button' : undefined}
      tabIndex={onAbrir ? 0 : undefined}
      style={{
        display: 'flex', gap: 'var(--mf-3)', alignItems: 'flex-start',
        padding: compacto ? 'var(--mf-3)' : 'var(--mf-4)',
        borderRadius: 'var(--mf-r-lg)',
        cursor: onAbrir ? 'pointer' : 'default',
        background: compacto
          ? (notificacao.lidaEm ? 'transparent' : 'color-mix(in oklch, ' + cor + ' 7%, transparent)')
          : 'color-mix(in oklch, var(--mf-surface-2) 94%, transparent)',
        border: `1px solid ${compacto
          ? 'var(--mf-border-subtle)'
          : `color-mix(in oklch, ${cor} 26%, var(--mf-border-strong))`}`,
        backdropFilter: compacto ? 'none' : 'blur(14px)',
        WebkitBackdropFilter: compacto ? 'none' : 'blur(14px)',
        boxShadow: compacto ? 'none' : 'var(--mf-shadow-3)',
        minWidth: 0,
      }}>

      <Avatar notificacao={notificacao} tamanho={compacto ? 32 : 38} />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--mf-2)' }}>
          <span style={{
            fontSize: compacto ? 'var(--mf-t-sm)' : 'var(--mf-t-body)',
            fontWeight: 700, color: 'var(--mf-text)', minWidth: 0, lineHeight: 1.35,
            /* Até duas linhas: "Novo cadastro esperando aprovação" cortado em
               "Novo cadastro espera…" no celular escondia justamente o assunto. */
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', overflowWrap: 'anywhere',
          }}>{notificacao.titulo}</span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
            flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}>{quandoFoi(notificacao.criadaEm)}</span>
        </div>

        <div style={{
          fontSize: compacto ? 'var(--mf-t-xs)' : 'var(--mf-t-sm)',
          color: 'var(--mf-text-2)', lineHeight: 1.5, marginTop: 3, overflowWrap: 'anywhere',
        }}>
          {partes.map((p, i) => p.destaque
            ? <strong key={i} style={{
                color: cor, fontWeight: 750, fontVariantNumeric: 'tabular-nums',
              }}>{compacto ? p.t : <Contador valor={p.t} />}</strong>
            : <span key={i}>{p.t}</span>)}
        </div>

        {notificacao.username && (
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 5 }}>
            @{notificacao.username}
            {notificacao.metricType === 'storyViews' ? ' · Story' : ''}
          </div>
        )}
      </div>

      {onFechar && (
        <button onClick={e => { e.stopPropagation(); onFechar(); }}
          aria-label="Dispensar"
          style={{
            flexShrink: 0, width: 22, height: 22, borderRadius: 'var(--mf-r-full)',
            display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
            background: 'transparent', border: 'none', color: 'var(--mf-text-3)',
          }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Uma linha da Central: lista corrida com divisória, ponto nas não lidas,
 * título, texto em até duas linhas e o @ só quando o texto não o traz.
 */
function Linha({ notificacao: n, onMarcarLida }) {
  const naoLida = !n.lidaEm;
  const mensagem = String(n.mensagem || '');
  const mostrarConta = n.username && !mensagem.toLowerCase().includes(`@${String(n.username).toLowerCase()}`);
  const partes = useMemo(() => {
    const numero = TEMAS_DE_METRICA.has(n.tema) && mensagem.match(NUMERO_DA_METRICA);
    if (!numero) return [{ t: mensagem }];
    return [
      { t: mensagem.slice(0, numero.index) },
      { t: numero[0], destaque: true },
      { t: mensagem.slice(numero.index + numero[0].length) },
    ];
  }, [mensagem, n.tema]);

  return (
    <div className="sa-linha" data-nao-lida={naoLida || undefined}
      onClick={() => naoLida && onMarcarLida?.()}
      role={naoLida && onMarcarLida ? 'button' : undefined} tabIndex={naoLida && onMarcarLida ? 0 : undefined}
      onKeyDown={e => { if (naoLida && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onMarcarLida?.(); } }}>
      <span className="sa-ponto" aria-hidden />
      <Avatar notificacao={n} tamanho={36} redondo />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="sa-titulo">{n.titulo}</span>
          <span style={{ flex: 1 }} />
          <span className="sa-quando">{quandoFoi(n.criadaEm)}</span>
        </div>
        {mensagem && (
          <div className="sa-texto">
            {partes.map((p, i) => p.destaque
              ? <strong key={i} style={{ color: 'var(--mf-text)', fontWeight: 700 }}>{p.t}</strong>
              : <span key={i}>{p.t}</span>)}
          </div>
        )}
        {(mostrarConta || n.metricType === 'storyViews') && (
          <div className="sa-meta">
            {mostrarConta ? `@${n.username}` : ''}{mostrarConta && n.metricType === 'storyViews' ? ' · ' : ''}{n.metricType === 'storyViews' ? 'Story' : ''}
          </div>
        )}
      </div>
      {naoLida && onMarcarLida && (
        <button type="button" className="sa-acao-linha" title="Marcar como lida" aria-label="Marcar como lida"
          onClick={e => { e.stopPropagation(); onMarcarLida(); }}>
          <Check size={14} />
        </button>
      )}
    </div>
  );
}

const CSS_CENTRAL = `
.sa-central { font-feature-settings: 'tnum'; }
.sa-icone-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--mf-r-sm);
  background: transparent; border: 1px solid transparent; color: var(--mf-text-3); cursor: pointer; padding: 0;
  transition: background var(--mf-fast) var(--mf-ease-out), color var(--mf-fast) var(--mf-ease-out); }
.sa-icone-btn:hover { background: var(--mf-surface-2); color: var(--mf-text); border-color: var(--mf-border); }
.sa-icone-btn[data-perigo]:hover { color: var(--mf-danger-500); }
.sa-icone-btn:focus-visible, .sa-aba:focus-visible, .sa-linha:focus-visible { outline: 2px solid var(--mf-primary-500); outline-offset: -2px; }
.sa-aba { position: relative; height: 36px; padding: 0 2px; margin-right: 16px; background: none; border: none; cursor: pointer;
  font-size: var(--mf-t-xs); font-weight: 650; color: var(--mf-text-3); display: inline-flex; align-items: center; gap: 6px; }
.sa-aba[aria-selected="true"] { color: var(--mf-text); }
.sa-aba[aria-selected="true"]::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  border-radius: 2px; background: var(--mf-primary-500); }
.sa-contagem { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-grid; place-items: center;
  font-size: 10px; font-weight: 800; background: var(--mf-surface-3); color: var(--mf-text-2); }
.sa-aba[aria-selected="true"] .sa-contagem { background: color-mix(in oklch, var(--mf-primary-500) 18%, transparent); color: var(--mf-primary-500); }
.sa-grupo { position: sticky; top: 0; z-index: 1; padding: 10px 16px 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--mf-text-3); background: var(--mf-surface-1); }
.sa-linha { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px 12px 22px;
  border-bottom: 1px solid var(--mf-border-subtle); transition: background var(--mf-fast) var(--mf-ease-out); }
.sa-linha:hover { background: color-mix(in oklch, var(--mf-surface-2) 70%, transparent); }
.sa-linha[data-nao-lida] { background: color-mix(in oklch, var(--mf-primary-500) 5%, transparent); cursor: pointer; }
.sa-linha[data-nao-lida]:hover { background: color-mix(in oklch, var(--mf-primary-500) 9%, transparent); }
.sa-ponto { position: absolute; left: 8px; top: 26px; width: 7px; height: 7px; border-radius: 50%; background: transparent; }
.sa-linha[data-nao-lida] .sa-ponto { background: var(--mf-primary-500); box-shadow: 0 0 8px var(--mf-primary-500); }
.sa-titulo { font-size: var(--mf-t-sm); font-weight: 600; color: var(--mf-text-2); line-height: 1.35; min-width: 0;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.sa-linha[data-nao-lida] .sa-titulo { color: var(--mf-text); font-weight: 700; }
.sa-quando { font-size: 11px; color: var(--mf-text-3); flex-shrink: 0; white-space: nowrap; }
.sa-texto { font-size: var(--mf-t-xs); color: var(--mf-text-3); line-height: 1.5; margin-top: 2px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.sa-linha[data-nao-lida] .sa-texto { color: var(--mf-text-2); }
.sa-meta { font-size: 11px; color: var(--mf-text-3); margin-top: 4px; }
.sa-acao-linha { position: absolute; right: 12px; top: 9px; width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer; padding: 0; opacity: 0;
  background: var(--mf-surface-2); border: 1px solid var(--mf-border); color: var(--mf-text-2);
  transition: opacity var(--mf-fast) var(--mf-ease-out); }
.sa-linha:hover .sa-acao-linha, .sa-acao-linha:focus-visible { opacity: 1; }
.sa-linha[data-nao-lida]:hover .sa-quando { visibility: hidden; }
.sa-acao-linha:hover { color: var(--mf-primary-500); border-color: color-mix(in oklch, var(--mf-primary-500) 45%, transparent); }
@media (hover: none) { .sa-acao-linha { display: none; } }
.sa-rodape { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 11px; text-decoration: none;
  border-top: 1px solid var(--mf-border); font-size: var(--mf-t-xs); font-weight: 650; color: var(--mf-text-3);
  transition: color var(--mf-fast) var(--mf-ease-out), background var(--mf-fast) var(--mf-ease-out); }
.sa-rodape:hover { color: var(--mf-text); background: var(--mf-surface-2); }
`;

/* ── Estado compartilhado ───────────────────────────────────────────────── */

const MAX_VISIVEIS = 3;
/* Avisos do sistema por carga: além disto, um resumo. */
const MAX_AVISOS_DO_SISTEMA = 3;


export function SmartActivityProvider({ children }) {
  const [persistidas, setPersistidas] = useState([]);
  const [naoLidasPersistidas, setNaoLidasPersistidas] = useState(0);

  /* ── Duas origens, uma Central ─────────────────────────────────────────
     O produto já tinha um sino: eventos de sistema (post publicado, conta
     conectada) num armazém em memória, que some no refresh. Os marcos são
     outra coisa — ficam gravados e valem histórico.

     Dois sinos na barra seriam absurdos, e descartar o antigo apagaria um
     aviso que hoje funciona. As duas listas se juntam aqui e a Central mostra
     as duas em ordem de tempo. O que é efêmero continua efêmero; o que é
     marco continua gravado. */
  const { notifs: efemeras, unread: naoLidasEfemeras } = useNotifications();
  const [fila, setFila] = useState([]);        // aguardando vaga
  const [visiveis, setVisiveis] = useState([]); // na tela
  const vistasRef = useRef(new Set());

  const carregar = useCallback(async ({ avisar = false } = {}) => {
    try {
      const { data } = await api.get('/notificacoes?limit=40');
      const lista = data.itens || [];
      setPersistidas(lista);
      setNaoLidasPersistidas(data.naoLidas || 0);

      if (!avisar) {
        // Primeira carga: nada vira aviso. Abrir o app não é o momento de
        // receber vinte pop-ups sobre o que aconteceu enquanto ele estava
        // fechado — isso é assunto da Central.
        lista.forEach(n => vistasRef.current.add(n.id));
        return;
      }
      const novas = lista.filter(n => !vistasRef.current.has(n.id) && !n.lidaEm);
      novas.forEach(n => vistasRef.current.add(n.id));
      if (novas.length) {
        /* Cartões internos: todos, na fila (a fila já limita quantos ficam na
           tela ao mesmo tempo). Aviso do sistema: no máximo 3 — os mais
           recentes — e um resumo para o resto. Agora que o worker avisa em
           tempo real, "novas" costuma ser uma; um lote grande só aparece
           depois de o app ficar fechado, e aí vinte pop-ups seguidos são a
           pior forma de contar. */
        setFila(f => [...f, ...[...novas].reverse()]);
        // No máximo 3, cada um com o próprio texto; sem aviso de resumo — o resto fica na Central.
        novas.slice(0, MAX_AVISOS_DO_SISTEMA).forEach(n => notificacaoDoNavegador.mostrar(n));
      }
    } catch { /* a Central some, o app segue */ }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* Reutiliza o SSE que já existe. Nenhuma conexão nova, nenhum polling. */
  useServerEvents(['notificacoes'], () => carregar({ avisar: true }));

  /* Promove da fila para a tela enquanto houver vaga. */
  useEffect(() => {
    if (!fila.length || visiveis.length >= MAX_VISIVEIS) return;
    const vagas = MAX_VISIVEIS - visiveis.length;
    setVisiveis(v => [...v, ...fila.slice(0, vagas)]);
    setFila(f => f.slice(vagas));
  }, [fila, visiveis.length]);

  const dispensar = useCallback(id => {
    setVisiveis(v => v.filter(n => n.id !== id));
  }, []);

  /* Abrir a Central recolhe a pilha: os mesmos avisos estão na lista, e os
     cartões por cima dela cobriam justamente o que se abriu para ler. */
  const recolherPilha = useCallback(() => { setVisiveis([]); setFila([]); }, []);
  // Com a Central aberta, aviso novo não aparece por cima dela (entra na lista).
  const [centralAberta, setCentralAberta] = useState(false);

  const marcarLida = useCallback(async id => {
    setPersistidas(l => l.map(n => n.id === id ? { ...n, lidaEm: new Date().toISOString() } : n));
    setNaoLidasPersistidas(n => Math.max(0, n - 1));
    try { await api.patch(`/notificacoes/${id}/lida`); } catch { /* volta no próximo carregar */ }
  }, []);

  const marcarTodas = useCallback(async () => {
    setPersistidas(l => l.map(n => ({ ...n, lidaEm: n.lidaEm || new Date().toISOString() })));
    setNaoLidasPersistidas(0);
    marcarEfemerasLidas();
    try { await api.post('/notificacoes/lidas'); } catch { /* idem */ }
  }, []);

  /**
   * Apaga as notificações já lidas.
   *
   * Só as lidas — o que ainda não foi visto não pode sumir por um clique de
   * limpeza. É essa restrição que torna a ação segura o bastante para não pedir
   * confirmação: no pior caso você perde o histórico do que já leu, nunca o
   * aviso que ainda não abriu.
   *
   * Remove da tela antes de o servidor responder. A lista é um espelho do
   * banco, e o próximo `carregar()` corrige se algo falhar — esperar a
   * viagem de rede para uma ação sem risco só faria o botão parecer travado.
   */
  const apagarLidas = useCallback(async () => {
    setPersistidas(l => l.filter(n => !n.lidaEm));
    try { await api.delete('/notificacoes/lidas'); }
    catch { carregar(); }
  }, [carregar]);

  /* O evento de sistema vira um cartão com a mesma forma do marco — assim a
     Central desenha os dois com o mesmo componente, sem um "se for do tipo X". */
  const itens = useMemo(() => {
    const convertidas = (efemeras || []).map(e => ({
      id: `ef-${e.id}`,
      titulo: e.msg,
      mensagem: '',
      tema: e.type === 'error' ? 'warning' : e.type === 'success' ? 'success' : 'info',
      criadaEm: e.time,
      lidaEm: null,
      efemera: true,
    }));
    return [...convertidas, ...persistidas]
      .sort((a, b) => new Date(b.criadaEm) - new Date(a.criadaEm));
  }, [efemeras, persistidas]);

  const naoLidas = naoLidasPersistidas + (naoLidasEfemeras || 0);

  /* "Some depois de" (Configurações de notificação). 0 = só ao fechar. Relido
     quando a tela de configuração salva — sem isto a escolha era gravada e
     a pilha seguia com 6s fixos. */
  const [duracaoMs, setDuracaoMs] = useState(6000);
  useEffect(() => {
    const ler = () => api.get('/notificacoes/config')
      .then(({ data }) => {
        const ms = Number(data?.exibicao?.duracaoMs);
        if (Number.isFinite(ms) && ms >= 0) setDuracaoMs(ms);
      })
      .catch(() => { /* fica o padrão */ });
    ler();
    window.addEventListener(EVENTO_CONFIG, ler);
    return () => window.removeEventListener(EVENTO_CONFIG, ler);
  }, []);

  const valor = useMemo(() => ({
    itens, naoLidas, visiveis, aguardando: fila.length, duracaoMs,
    centralAberta, setCentralAberta, dispensar, recolherPilha, marcarLida, marcarTodas, apagarLidas, recarregar: carregar,
  }), [itens, naoLidas, visiveis, fila.length, duracaoMs, centralAberta, dispensar, recolherPilha, marcarLida, marcarTodas, apagarLidas, carregar]);

  return <ContextoSmartActivity.Provider value={valor}>{children}</ContextoSmartActivity.Provider>;
}

/* ── Pilha de avisos ────────────────────────────────────────────────────── */

/** Some sozinho depois da duração (0 = só ao fechar); o relógio pausa sob o cursor. */
function Aviso({ notificacao, onFechar, duracao = 6000 }) {
  const [entrando, setEntrando] = useState(true);
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntrando(false), 20);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (pausado || !duracao) return;
    const t = setTimeout(onFechar, duracao);
    return () => clearTimeout(t);
  }, [pausado, duracao, onFechar]);

  return (
    <div
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      style={{
        transform: entrando ? 'translateY(-14px)' : 'translateY(0)',
        opacity: entrando ? 0 : 1,
        transition: 'transform var(--mf-slow) var(--mf-ease-out), opacity var(--mf-normal) var(--mf-ease-out)',
        pointerEvents: 'auto',
      }}>
      <Cartao notificacao={notificacao} onFechar={onFechar} />
    </div>
  );
}

export function PilhaDeAvisos() {
  const { visiveis, aguardando, dispensar, duracaoMs, centralAberta } = useSmartActivity();
  if (!visiveis?.length || centralAberta) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', top: 'calc(var(--mf-topbar) + var(--mf-3))',
        right: 'var(--mf-4)', zIndex: 'var(--mf-z-toast)',
        display: 'flex', flexDirection: 'column', gap: 'var(--mf-2)',
        width: 'min(370px, calc(100vw - var(--mf-8)))',
        pointerEvents: 'none',
      }}>
      {visiveis.map(n => (
        <Aviso key={n.id} notificacao={n} duracao={duracaoMs} onFechar={() => dispensar(n.id)} />
      ))}

      {aguardando > 0 && (
        <div style={{
          alignSelf: 'flex-end', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
          background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)',
          borderRadius: 'var(--mf-r-full)', padding: '2px 8px', pointerEvents: 'auto',
        }}>
          +{aguardando} na fila
        </div>
      )}
    </div>
  );
}

/* ── Central ────────────────────────────────────────────────────────────── */

/** Agrupa por dia: "Hoje", "Ontem", data. */
function agrupar(itens) {
  const hoje = new Date().toDateString();
  const ontem = new Date(Date.now() - 864e5).toDateString();
  const grupos = new Map();
  for (const n of itens) {
    const d = new Date(n.criadaEm).toDateString();
    const rotulo = d === hoje ? 'Hoje' : d === ontem ? 'Ontem'
      : new Date(n.criadaEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    if (!grupos.has(rotulo)) grupos.set(rotulo, []);
    grupos.get(rotulo).push(n);
  }
  return [...grupos.entries()];
}

export function SinoDeNotificacoes() {
  const { itens, naoLidas, marcarLida, marcarTodas, apagarLidas, recolherPilha, setCentralAberta } = useSmartActivity();
  /* Só as PERSISTIDAS contam. As efêmeras vivem na memória da aba e somem
     sozinhas; oferecer "apagar" para elas prometeria uma limpeza que o botão
     não faz. */
  const lidas = itens.filter(n => n.lidaEm && !n.efemera).length;
  const [aberta, setAberta] = useState(false);
  const caixaRef = useRef(null);

  /* Numa tela estreita o painel ancora na VIEWPORT, não na sineta.

     `right: 0` alinha a borda direita do painel à da sineta — o certo no
     desktop, onde o painel nasce colado ao gatilho e sobra espaço à
     esquerda. No celular não sobra: a sineta fica a ~60px da borda direita
     e o painel pede quase a largura toda da tela, então a borda esquerda
     dele cai em NEGATIVO e o `overflow-x: clip` do body corta a faixa —
     medido numa tela de 390px, o painel nascia em `x: -38`, com os ícones
     dos cartões cortados pela margem. */
  const [estreito, setEstreito] = useState(
    () => window.matchMedia('(max-width: 640px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const aoMudar = e => setEstreito(e.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  useEffect(() => {
    if (!aberta) return;
    const fora = e => { if (caixaRef.current && !caixaRef.current.contains(e.target)) setAberta(false); };
    const esc = e => { if (e.key === 'Escape') setAberta(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberta]);

  const [filtro, setFiltro] = useState('todas');
  const grupos = useMemo(
    () => agrupar((itens || []).filter(n => filtro === 'todas' || !n.lidaEm)),
    [itens, filtro]);

  useEffect(() => { setCentralAberta?.(aberta); }, [aberta, setCentralAberta]);

  return (
    <div ref={caixaRef} style={{ position: 'relative' }}>
      <button onClick={() => { if (!aberta) recolherPilha?.(); setAberta(a => !a); }}
        aria-label={naoLidas ? `${naoLidas} notificações não lidas` : 'Notificações'}
        style={{
          position: 'relative', width: 34, height: 34, borderRadius: 'var(--mf-r-md)',
          display: 'grid', placeItems: 'center', cursor: 'pointer',
          background: aberta ? 'var(--mf-surface-2)' : 'transparent',
          border: '1px solid ' + (aberta ? 'var(--mf-border-strong)' : 'transparent'),
          color: 'var(--mf-text-2)',
        }}>
        <Bell size={17} />
        {naoLidas > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 'var(--mf-r-full)',
            background: 'var(--mf-danger-500)', color: 'var(--mf-bg)',
            fontSize: 'var(--mf-t-nano)', fontWeight: 800,
            display: 'grid', placeItems: 'center',
            border: '2px solid var(--mf-bg)',
            fontVariantNumeric: 'tabular-nums',
          }}>{naoLidas > 99 ? '99+' : naoLidas}</span>
        )}
      </button>

      {aberta && (
        <div className="sa-central" role="dialog" aria-label="Notificações" style={{
          ...(estreito
            ? { position: 'fixed', top: 'calc(var(--mf-topbar) + 8px)',
                left: 'var(--mf-3)', right: 'var(--mf-3)', width: 'auto' }
            : { position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                width: 'min(400px, calc(100vw - var(--mf-6)))' }),
          maxHeight: 'min(560px, calc(100vh - var(--mf-topbar) - var(--mf-8)))',
          display: 'flex', flexDirection: 'column',
          background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border-strong)',
          borderRadius: 'var(--mf-r-lg)', boxShadow: 'var(--mf-shadow-3)',
          zIndex: 'var(--mf-z-drawer)', overflow: 'hidden',
        }}>
          <style>{CSS_CENTRAL}</style>

          {/* Cabeçalho: título e ações em ícone (com dica) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0 16px' }}>
            <span style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)' }}>Notificações</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="sa-icone-btn" onClick={marcarTodas} disabled={!naoLidas}
              title="Marcar todas como lidas" aria-label="Marcar todas como lidas" style={{ opacity: naoLidas ? 1 : .35 }}>
              <CheckCheck size={16} />
            </button>
            {/* Só as lidas somem — o que não foi visto não sai por um clique. */}
            <button type="button" className="sa-icone-btn" data-perigo onClick={apagarLidas} disabled={!lidas}
              title={lidas ? `Apagar ${lidas} lida${lidas === 1 ? '' : 's'}` : 'Nada lido para apagar'} aria-label="Apagar lidas"
              style={{ opacity: lidas ? 1 : .35 }}>
              <Trash2 size={15} />
            </button>
            <a href="/settings/notificacoes" className="sa-icone-btn" title="Configurar notificações" aria-label="Configurar notificações">
              <Settings size={15} />
            </a>
          </div>

          {/* Abas */}
          <div role="tablist" style={{ display: 'flex', padding: '4px 16px 0', borderBottom: '1px solid var(--mf-border)' }}>
            {[['todas', 'Todas', null], ['naoLidas', 'Não lidas', naoLidas]].map(([id, rot, n]) => (
              <button key={id} type="button" role="tab" className="sa-aba" aria-selected={filtro === id} onClick={() => setFiltro(id)}>
                {rot}{n > 0 && <span className="sa-contagem">{n > 99 ? '99+' : n}</span>}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {!grupos.length && (
              <div style={{ padding: '44px 24px', textAlign: 'center' }}>
                <span style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)', color: 'var(--mf-text-3)' }}>
                  {filtro === 'naoLidas' ? <CheckCheck size={18} /> : <BellOff size={18} />}
                </span>
                <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>
                  {filtro === 'naoLidas' ? 'Tudo em dia' : 'Nenhuma notificação'}
                </div>
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 4, lineHeight: 1.6 }}>
                  {filtro === 'naoLidas' ? 'Você já leu todas as notificações.' : 'Os avisos de publicações, envios e marcos aparecem aqui.'}
                </div>
              </div>
            )}

            {grupos.map(([rotulo, lista]) => (
              <section key={rotulo} aria-label={rotulo}>
                <div className="sa-grupo">{rotulo}</div>
                {lista.map(n => (
                  <Linha key={n.id} notificacao={n}
                    onMarcarLida={n.efemera ? undefined : () => marcarLida(n.id)} />
                ))}
              </section>
            ))}
          </div>

          <a href="/settings/notificacoes" className="sa-rodape">
            <Settings size={13} /> Configurar notificações
          </a>
        </div>
      )}
    </div>
  );
}
