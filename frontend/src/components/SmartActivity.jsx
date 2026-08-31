import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bell, X, TrendingUp, Flame, Eye, Award, Info, AlertTriangle, CheckCheck } from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { ContextoSmartActivity, useSmartActivity } from '../services/smartActivityContexto';
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
 * O monograma da marca, em traço contínuo.
 *
 * Desenhado aqui em vez de carregado de `/mouraflow-icon.svg` por um motivo
 * concreto: um SVG servido como arquivo e usado em `<img>` não enxerga as
 * variáveis CSS da página — o gradiente ficaria cravado nos hexadecimais do
 * arquivo, que são de antes do Nocturno. Inline, ele acompanha o tema.
 */
function Monograma({ tamanho = 20 }) {
  /* `useId` e não uma constante: a pilha mostra até três avisos e a Central
     mostra dezenas, todos com este monograma. Com um id fixo, o documento
     ficaria cheio de `<linearGradient id="mf-marca">` repetidos — e `url(#id)`
     resolve para o PRIMEIRO do documento. Enquanto todos são idênticos ninguém
     nota; quando o primeiro cartão é dispensado, os outros perdem o gradiente
     e viram traço preto. */
  const id = useId();
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"   stopColor="var(--mf-mod-publicar)" />
          <stop offset="100%" stopColor="var(--mf-primary-500)" />
        </linearGradient>
      </defs>
      <path d="M5 25V9.5l11 9 11-9V25" fill="none" stroke={`url(#${id})`}
        strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="18.5" r="3.2" fill="var(--mf-primary-500)" />
    </svg>
  );
}

function Avatar({ notificacao, tamanho = 38 }) {
  const [falhou, setFalhou] = useState(false);
  const src = urlDoAvatar(notificacao.avatar);
  const { icone: Ico, cor } = temaDe(notificacao.tema);

  return (
    <span style={{
      width: tamanho, height: tamanho, borderRadius: 'var(--mf-r-md)', flexShrink: 0,
      position: 'relative', display: 'grid', placeItems: 'center', overflow: 'visible',
      background: `color-mix(in oklch, ${cor} 14%, var(--mf-surface-2))`,
      boxShadow: `0 0 0 1px color-mix(in oklch, ${cor} 30%, transparent)`,
    }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 'var(--mf-r-md)',
        overflow: 'hidden', display: 'grid', placeItems: 'center',
      }}>
        {/* Sem foto sincronizada, entra a MARCA — não as iniciais.
        
            Iniciais identificam a conta, mas o cartão já faz isso na linha de
            baixo, com o @ por extenso. Duas letras genéricas num quadrado
            colorido pareciam avatar quebrado; o monograma parece decisão. */}
        {src && !falhou
          ? <img src={src} alt="" onError={() => setFalhou(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Monograma tamanho={Math.round(tamanho * 0.62)} />}
      </span>

      {/* O selo do tema fica FORA do recorte do avatar: dentro, ele seria
          cortado pelo canto arredondado e viraria uma meia-lua. */}
      <span style={{
        position: 'absolute', right: -5, bottom: -5,
        width: 18, height: 18, borderRadius: 'var(--mf-r-full)',
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
    const numero = m.match(/[\d][\d.,]*/);
    if (!numero) return [{ t: m }];
    const i = numero.index;
    return [
      { t: m.slice(0, i) },
      { t: numero[0], destaque: true },
      { t: m.slice(i + numero[0].length) },
    ];
  }, [notificacao.mensagem]);

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
            fontWeight: 700, color: 'var(--mf-text)', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{notificacao.titulo}</span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
            flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}>{quandoFoi(notificacao.criadaEm)}</span>
        </div>

        <div style={{
          fontSize: compacto ? 'var(--mf-t-xs)' : 'var(--mf-t-sm)',
          color: 'var(--mf-text-2)', lineHeight: 1.5, marginTop: 3,
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

/* ── Estado compartilhado ───────────────────────────────────────────────── */

const MAX_VISIVEIS = 3;


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
        lista.forEach(n => vistasRef.current.add(n._id));
        return;
      }
      const novas = lista.filter(n => !vistasRef.current.has(n._id) && !n.lidaEm);
      novas.forEach(n => vistasRef.current.add(n._id));
      if (novas.length) {
        setFila(f => [...f, ...novas.reverse()]);
        novas.forEach(n => notificacaoDoNavegador.mostrar(n));
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
    setVisiveis(v => v.filter(n => n._id !== id));
  }, []);

  const marcarLida = useCallback(async id => {
    setPersistidas(l => l.map(n => n._id === id ? { ...n, lidaEm: new Date().toISOString() } : n));
    setNaoLidasPersistidas(n => Math.max(0, n - 1));
    try { await api.patch(`/notificacoes/${id}/lida`); } catch { /* volta no próximo carregar */ }
  }, []);

  const marcarTodas = useCallback(async () => {
    setPersistidas(l => l.map(n => ({ ...n, lidaEm: n.lidaEm || new Date().toISOString() })));
    setNaoLidasPersistidas(0);
    marcarEfemerasLidas();
    try { await api.post('/notificacoes/lidas'); } catch { /* idem */ }
  }, []);

  /* O evento de sistema vira um cartão com a mesma forma do marco — assim a
     Central desenha os dois com o mesmo componente, sem um "se for do tipo X". */
  const itens = useMemo(() => {
    const convertidas = (efemeras || []).map(e => ({
      _id: `ef-${e.id}`,
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

  const valor = useMemo(() => ({
    itens, naoLidas, visiveis, aguardando: fila.length,
    dispensar, marcarLida, marcarTodas, recarregar: carregar,
  }), [itens, naoLidas, visiveis, fila.length, dispensar, marcarLida, marcarTodas, carregar]);

  return <ContextoSmartActivity.Provider value={valor}>{children}</ContextoSmartActivity.Provider>;
}

/* ── Pilha de avisos ────────────────────────────────────────────────────── */

/** Some sozinho depois da duração; o relógio pausa sob o cursor. */
function Aviso({ notificacao, onFechar, duracao = 6000 }) {
  const [entrando, setEntrando] = useState(true);
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntrando(false), 20);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (pausado) return;
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
  const { visiveis, aguardando, dispensar } = useSmartActivity();
  if (!visiveis?.length) return null;

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
        <Aviso key={n._id} notificacao={n} onFechar={() => dispensar(n._id)} />
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
  const { itens, naoLidas, marcarLida, marcarTodas } = useSmartActivity();
  const [aberta, setAberta] = useState(false);
  const caixaRef = useRef(null);

  useEffect(() => {
    if (!aberta) return;
    const fora = e => { if (caixaRef.current && !caixaRef.current.contains(e.target)) setAberta(false); };
    const esc = e => { if (e.key === 'Escape') setAberta(false); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); };
  }, [aberta]);

  const grupos = useMemo(() => agrupar(itens || []), [itens]);

  return (
    <div ref={caixaRef} style={{ position: 'relative' }}>
      <button onClick={() => setAberta(a => !a)}
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
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 'min(380px, calc(100vw - var(--mf-6)))',
          maxHeight: 'min(520px, calc(100vh - var(--mf-topbar) - var(--mf-8)))',
          display: 'flex', flexDirection: 'column',
          background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border-strong)',
          borderRadius: 'var(--mf-r-lg)', boxShadow: 'var(--mf-shadow-3)',
          zIndex: 'var(--mf-z-drawer)', overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--mf-2)',
            padding: 'var(--mf-3) var(--mf-4)', borderBottom: '1px solid var(--mf-border)',
          }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>
              Notificações
            </span>
            <span style={{ flex: 1 }} />
            {naoLidas > 0 && (
              <button onClick={marcarTodas} style={{
                fontSize: 'var(--mf-t-nano)', fontWeight: 700, cursor: 'pointer',
                background: 'transparent', border: 'none',
                color: 'var(--mf-primary-500)', padding: 0,
              }}>Marcar todas como lidas</button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--mf-2)' }}>
            {!grupos.length && (
              <div style={{
                padding: 'var(--mf-10) var(--mf-4)', textAlign: 'center',
                fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.7,
              }}>
                Nada por aqui ainda.<br />
                Marcos de visualização aparecem assim que suas contas alcançarem os primeiros números.
              </div>
            )}

            {grupos.map(([rotulo, lista]) => (
              <div key={rotulo}>
                <div style={{
                  fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em',
                  color: 'var(--mf-text-3)', padding: 'var(--mf-3) var(--mf-2) var(--mf-1)',
                }}>{rotulo.toUpperCase()}</div>
                {lista.map(n => (
                  <Cartao key={n._id} notificacao={n} compacto
                    onAbrir={() => !n.lidaEm && !n.efemera && marcarLida(n._id)} />
                ))}
              </div>
            ))}
          </div>

          {/* Um caminho para os ajustes a partir de onde a dúvida nasce: é
              olhando uma notificação que se decide mudar o que ela diz. */}
          <a href="/settings/notificacoes" style={{
            display: 'block', textAlign: 'center', textDecoration: 'none',
            padding: 'var(--mf-3)', borderTop: '1px solid var(--mf-border)',
            fontSize: 'var(--mf-t-nano)', fontWeight: 700, color: 'var(--mf-text-3)',
          }}>Configurar notificações</a>
        </div>
      )}
    </div>
  );
}
