import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Send, RefreshCw, Megaphone, Users, BarChart3, Settings,
  Search, Bell, ChevronDown, Play, Pause, Check, X, TrendingUp, AlertTriangle,
  Info, CircleCheck, MoreHorizontal, Plus, Sparkles,
} from 'lucide-react';
import { PALETAS, conferirContraste } from '../design/paletas';

/**
 * Vitrine das oito propostas de identidade.
 *
 * ── O que esta página é, e o que ela NÃO é
 *
 * É uma tela de decisão. Nenhuma paleta daqui está aplicada ao produto: cada
 * vitrine escreve os próprios tokens como `--p-*` num contêiner isolado, e
 * nada vaza para o `--mf-*` que o app usa de verdade. Escolher aqui só grava
 * a preferência; aplicar é outro passo, com o usuário no comando.
 *
 * ── Por que um fac-símile do app e não uma cartela de cores
 *
 * Cartela de cores mente. Um azul que parece elegante num quadrado de 80px
 * pode ser insuportável como fundo de uma tabela com trinta linhas, e um
 * acento que parece tímido isolado pode dominar a tela quando aparece em oito
 * lugares ao mesmo tempo. A única forma honesta de comparar paletas é
 * montá-las na densidade real do produto — barra lateral, cartão de métrica,
 * tabela, gráfico, estado — e olhar.
 *
 * ── Por que os componentes são desenhados aqui e não importados
 *
 * Os componentes reais leem `--mf-*`. Usá-los aqui obrigaria a sobrescrever
 * aqueles tokens no contêiner, e aí a vitrine passaria a mexer no tema do app
 * — exatamente o que esta etapa não pode fazer. As cópias abaixo são
 * deliberadamente simples: elas existem para mostrar COR em contexto, não
 * para substituir o design system.
 */

const ARMAZEM = 'mf_paleta_escolhida';

/* ── Tokens da vitrine ────────────────────────────────────────────────────
   Prefixo `--p-` de proposta. Nunca `--mf-`: se colidissem, abrir esta página
   repintaria o app inteiro por baixo. */
function tokensDe(modo) {
  return {
    '--p-bg': modo.bg,
    '--p-s1': modo.surface1,
    '--p-s2': modo.surface2,
    '--p-s3': modo.surface3,
    '--p-fg': modo.fg,
    '--p-fg2': modo.fg2,
    '--p-fg3': modo.fg3,
    '--p-bd': modo.border,
    '--p-bd2': modo.borderForte,
    '--p-primary': modo.primary,
    '--p-primary-fg': modo.primaryFg,
    '--p-secondary': modo.secondary,
    '--p-secondary-fg': modo.secondaryFg,
    '--p-accent': modo.accent,
    '--p-accent-fg': modo.accentFg,
    '--p-success': modo.success,
    '--p-warning': modo.warning,
    '--p-destructive': modo.destructive,
    '--p-info': modo.info,
    '--p-c1': modo.grafico[0],
    '--p-c2': modo.grafico[1],
    '--p-c3': modo.grafico[2],
    '--p-c4': modo.grafico[3],
    '--p-c5': modo.grafico[4],
  };
}

/* ── Peças ────────────────────────────────────────────────────────────────
   Todas leem só `--p-*`, então trocar de paleta é trocar o contêiner. */

const NAV = [
  { icone: LayoutDashboard, rotulo: 'Dashboard' },
  { icone: Send, rotulo: 'Postar' },
  { icone: RefreshCw, rotulo: 'Loop' },
  { icone: Megaphone, rotulo: 'Campanhas', ativo: true },
  { icone: Users, rotulo: 'Contas' },
  { icone: BarChart3, rotulo: 'Métricas' },
  { icone: Settings, rotulo: 'Ajustes' },
];

function Sidebar({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <aside style={{
      width: px(190), flexShrink: 0, background: 'var(--p-s1)',
      borderRight: '1px solid var(--p-bd)', padding: `${px(14)} ${px(10)}`,
      display: 'flex', flexDirection: 'column', gap: px(3),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: px(9), padding: `0 ${px(6)} ${px(14)}` }}>
        <span style={{
          width: px(26), height: px(26), borderRadius: px(8), flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: 'linear-gradient(135deg, var(--p-primary), var(--p-secondary))',
          color: 'var(--p-primary-fg)',
        }}>
          <Sparkles size={13 * escala} />
        </span>
        <span style={{ fontSize: px(13), fontWeight: 750, color: 'var(--p-fg)', letterSpacing: '-.01em' }}>
          MouraFlow
        </span>
      </div>

      <div style={{ fontSize: px(9), fontWeight: 700, color: 'var(--p-fg3)', letterSpacing: '.09em', padding: `${px(4)} ${px(7)} ${px(5)}` }}>
        PUBLICAÇÃO
      </div>

      {NAV.map(({ icone: Ico, rotulo, ativo }) => (
        <div key={rotulo} style={{
          display: 'flex', alignItems: 'center', gap: px(9),
          padding: `${px(7)} ${px(8)}`, borderRadius: px(8),
          position: 'relative',
          fontSize: px(12), fontWeight: ativo ? 700 : 550,
          color: ativo ? 'var(--p-fg)' : 'var(--p-fg2)',
          background: ativo
            ? 'color-mix(in oklch, var(--p-primary) 15%, transparent)'
            : 'transparent',
        }}>
          {/* O item ativo é marcado por TRÊS coisas somadas — filete, fundo e
              peso do texto. Só o fundo não sobrevive a quem enxerga pouca cor. */}
          {ativo && (
            <span style={{
              position: 'absolute', left: px(-10), top: '22%', bottom: '22%',
              width: px(3), borderRadius: `0 ${px(3)} ${px(3)} 0`,
              background: 'var(--p-primary)',
            }} />
          )}
          <Ico size={14 * escala} style={{ color: ativo ? 'var(--p-primary)' : 'var(--p-fg3)', flexShrink: 0 }} />
          {rotulo}
        </div>
      ))}
    </aside>
  );
}

function Topbar({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <div style={{
      height: px(46), flexShrink: 0, display: 'flex', alignItems: 'center', gap: px(10),
      padding: `0 ${px(16)}`, borderBottom: '1px solid var(--p-bd)',
      background: 'color-mix(in oklch, var(--p-s1) 70%, transparent)',
    }}>
      <div style={{
        flex: 1, maxWidth: px(260), height: px(28), borderRadius: px(8),
        border: '1px solid var(--p-bd)', background: 'var(--p-s2)',
        display: 'flex', alignItems: 'center', gap: px(7), padding: `0 ${px(9)}`,
        fontSize: px(11), color: 'var(--p-fg3)',
      }}>
        <Search size={12 * escala} /> Buscar…
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative', color: 'var(--p-fg2)' }}>
        <Bell size={15 * escala} />
        <span style={{
          position: 'absolute', top: px(-3), right: px(-3), minWidth: px(13), height: px(13),
          borderRadius: px(7), background: 'var(--p-destructive)', color: 'var(--p-bg)',
          fontSize: px(8), fontWeight: 800, display: 'grid', placeItems: 'center', padding: `0 ${px(3)}`,
        }}>3</span>
      </div>
      <span style={{
        width: px(24), height: px(24), borderRadius: 'var(--mf-r-full)',
        background: 'linear-gradient(135deg, var(--p-secondary), var(--p-accent))',
        color: 'var(--p-bg)', fontSize: px(9), fontWeight: 800,
        display: 'grid', placeItems: 'center',
      }}>VM</span>
    </div>
  );
}

function Cartao({ children, escala = 1, estilo }) {
  const px = n => `${n * escala}px`;
  return (
    <div style={{
      background: 'var(--p-s1)', border: '1px solid var(--p-bd)',
      borderRadius: px(12), padding: px(13),
      boxShadow: 'var(--mf-shadow-1)',
      minWidth: 0, ...estilo,
    }}>{children}</div>
  );
}

function Metrica({ rotulo, valor, delta, cor, escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <Cartao escala={escala}>
      <div style={{ fontSize: px(9.5), color: 'var(--p-fg3)', letterSpacing: '.05em', fontWeight: 650 }}>
        {rotulo}
      </div>
      <div style={{
        fontSize: px(23), fontWeight: 750, color: 'var(--p-fg)', lineHeight: 1.15,
        marginTop: px(5), fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em',
      }}>{valor}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: px(4), marginTop: px(5) }}>
        <TrendingUp size={10 * escala} style={{ color: cor }} />
        <span style={{ fontSize: px(10), fontWeight: 700, color: cor }}>{delta}</span>
        <span style={{ fontSize: px(10), color: 'var(--p-fg3)' }}>vs. semana</span>
      </div>
    </Cartao>
  );
}

/* Gráfico desenhado à mão em SVG: um mock não precisa da biblioteca de
   verdade, e assim a vitrine não depende de nada para renderizar. */
function Grafico({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  const serie = [22, 30, 26, 41, 38, 52, 47, 63, 58, 74, 69, 88];
  const largura = 300, altura = 74;
  const pts = serie.map((v, i) => [
    (i / (serie.length - 1)) * largura,
    altura - (v / 100) * altura,
  ]);
  const linha = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ');
  return (
    <Cartao escala={escala}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: px(9) }}>
        <span style={{ fontSize: px(11.5), fontWeight: 700, color: 'var(--p-fg)' }}>Visualizações</span>
        <span style={{ fontSize: px(9.5), color: 'var(--p-fg3)' }}>12 semanas</span>
      </div>
      <svg viewBox={`0 0 ${largura} ${altura}`} style={{ width: '100%', height: px(74), display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`g-${escala}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--p-c1)" stopOpacity=".32" />
            <stop offset="100%" stopColor="var(--p-c1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1="0" y1={altura * f} x2={largura} y2={altura * f}
            stroke="var(--p-bd)" strokeWidth="1" />
        ))}
        <path d={`M ${linha} L ${largura},${altura} L 0,${altura} Z`} fill={`url(#g-${escala})`} />
        <path d={`M ${linha}`} fill="none" stroke="var(--p-c1)" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="var(--p-c1)" />
      </svg>
      <div style={{ display: 'flex', gap: px(10), marginTop: px(9), flexWrap: 'wrap' }}>
        {['Reels', 'Stories', 'Feed'].map((s, i) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: px(4), fontSize: px(9.5), color: 'var(--p-fg3)' }}>
            <span style={{ width: px(7), height: px(7), borderRadius: px(2), background: `var(--p-c${i + 1})` }} />
            {s}
          </span>
        ))}
      </div>
    </Cartao>
  );
}

function Selo({ tipo, children, escala = 1 }) {
  const px = n => `${n * escala}px`;
  const cor = `var(--p-${tipo})`;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: px(4),
      fontSize: px(9.5), fontWeight: 700, padding: `${px(2)} ${px(7)}`,
      borderRadius: px(20), whiteSpace: 'nowrap',
      background: `color-mix(in oklch, ${cor} 16%, transparent)`,
      color: cor,
      border: `1px solid color-mix(in oklch, ${cor} 32%, transparent)`,
    }}>{children}</span>
  );
}

function Botao({ variante = 'primary', children, escala = 1, largo }) {
  const px = n => `${n * escala}px`;
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: px(5),
    fontSize: px(11.5), fontWeight: 650, padding: `${px(7)} ${px(13)}`,
    borderRadius: px(9), cursor: 'default', whiteSpace: 'nowrap',
    width: largo ? '100%' : undefined,
  };
  const v = {
    primary: { background: 'var(--p-primary)', color: 'var(--p-primary-fg)', border: '1px solid transparent' },
    secondary: { background: 'var(--p-s3)', color: 'var(--p-fg)', border: '1px solid var(--p-bd2)' },
    ghost: { background: 'transparent', color: 'var(--p-fg2)', border: '1px solid transparent' },
    outline: { background: 'transparent', color: 'var(--p-fg2)', border: '1px solid var(--p-bd2)' },
    destructive: {
      background: 'color-mix(in oklch, var(--p-destructive) 14%, transparent)',
      color: 'var(--p-destructive)',
      border: '1px solid color-mix(in oklch, var(--p-destructive) 34%, transparent)',
    },
  }[variante];
  return <span style={{ ...base, ...v }}>{children}</span>;
}

function Campo({ rotulo, valor, escala = 1, tipo = 'input' }) {
  const px = n => `${n * escala}px`;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: px(9.5), fontWeight: 650, color: 'var(--p-fg3)', marginBottom: px(4), letterSpacing: '.04em' }}>
        {rotulo}
      </div>
      <div style={{
        height: px(30), borderRadius: px(8), border: '1px solid var(--p-bd2)',
        background: 'var(--p-s2)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: `0 ${px(9)}`,
        fontSize: px(11), color: valor ? 'var(--p-fg)' : 'var(--p-fg3)',
      }}>
        {valor || 'Selecione…'}
        {tipo === 'select' && <ChevronDown size={12 * escala} style={{ color: 'var(--p-fg3)' }} />}
      </div>
    </div>
  );
}

function Tabela({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  const linhas = [
    ['@oliviapaganini', 'Reel', '12.482', 'success', 'Publicado'],
    ['@priscilamazza', 'Story', '3.201', 'warning', 'Na fila'],
    ['@larissagomes2g', 'Reel', '48.930', 'success', 'Publicado'],
    ['@karolmendes', 'Reel', '—', 'destructive', 'Falhou'],
  ];
  return (
    <Cartao escala={escala} estilo={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: `${px(11)} ${px(13)}`, borderBottom: '1px solid var(--p-bd)',
      }}>
        <span style={{ fontSize: px(11.5), fontWeight: 700, color: 'var(--p-fg)' }}>Publicações recentes</span>
        <MoreHorizontal size={14 * escala} style={{ color: 'var(--p-fg3)' }} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: px(300) }}>
          <thead>
            <tr>
              {['Conta', 'Tipo', 'Views', 'Estado'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Views' ? 'right' : 'left',
                  fontSize: px(9), fontWeight: 700, color: 'var(--p-fg3)',
                  letterSpacing: '.07em', padding: `${px(7)} ${px(13)}`,
                  borderBottom: '1px solid var(--p-bd)', whiteSpace: 'nowrap',
                }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map(([conta, tipo, views, estado, rotulo]) => (
              <tr key={conta}>
                <td style={{ padding: `${px(8)} ${px(13)}`, fontSize: px(10.5), color: 'var(--p-fg)', borderBottom: '1px solid var(--p-bd)', whiteSpace: 'nowrap' }}>{conta}</td>
                <td style={{ padding: `${px(8)} ${px(13)}`, fontSize: px(10.5), color: 'var(--p-fg2)', borderBottom: '1px solid var(--p-bd)' }}>{tipo}</td>
                <td style={{ padding: `${px(8)} ${px(13)}`, fontSize: px(10.5), color: 'var(--p-fg)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--p-bd)' }}>{views}</td>
                <td style={{ padding: `${px(8)} ${px(13)}`, borderBottom: '1px solid var(--p-bd)' }}>
                  <Selo tipo={estado} escala={escala}>{rotulo}</Selo>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

function Notificacao({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <div style={{
      display: 'flex', gap: px(9), alignItems: 'flex-start',
      background: 'var(--p-s2)', border: '1px solid var(--p-bd2)',
      borderRadius: px(12), padding: px(11),
      boxShadow: '0 8px 24px -8px oklch(0 0 0 / .4)',
    }}>
      <span style={{
        width: px(28), height: px(28), borderRadius: 'var(--mf-r-full)', flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: 'linear-gradient(135deg, var(--p-accent), var(--p-primary))',
        color: 'var(--p-bg)',
      }}>
        <TrendingUp size={13 * escala} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: px(11), fontWeight: 700, color: 'var(--p-fg)' }}>
          Seu Story está bombando 🚀
        </div>
        <div style={{ fontSize: px(10), color: 'var(--p-fg2)', marginTop: px(2), lineHeight: 1.45 }}>
          <strong style={{ color: 'var(--p-primary)' }}>@oliviapaganini</strong> chegou a 1.024 visualizações.
        </div>
        <div style={{ fontSize: px(9), color: 'var(--p-fg3)', marginTop: px(4) }}>Story · agora</div>
      </div>
      <X size={12 * escala} style={{ color: 'var(--p-fg3)', flexShrink: 0 }} />
    </div>
  );
}

function Modal({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <Cartao escala={escala} estilo={{ padding: 0, overflow: 'hidden', boxShadow: '0 16px 44px -12px oklch(0 0 0 / .5)' }}>
      <div style={{ padding: `${px(13)} ${px(14)}`, borderBottom: '1px solid var(--p-bd)' }}>
        <div style={{ fontSize: px(12.5), fontWeight: 750, color: 'var(--p-fg)' }}>Publicar campanha</div>
        <div style={{ fontSize: px(10), color: 'var(--p-fg3)', marginTop: px(2) }}>
          16 publicações em 4 contas
        </div>
      </div>
      <div style={{ padding: px(14), display: 'flex', flexDirection: 'column', gap: px(9) }}>
        <Campo rotulo="ESTRATÉGIA" valor="Distribuição intercalada" tipo="select" escala={escala} />
        <Campo rotulo="INTERVALO" valor="25 min (fixo)" escala={escala} />
      </div>
      <div style={{ display: 'flex', gap: px(7), justifyContent: 'flex-end', padding: `${px(11)} ${px(14)}`, borderTop: '1px solid var(--p-bd)' }}>
        <Botao variante="ghost" escala={escala}>Cancelar</Botao>
        <Botao variante="primary" escala={escala}>Publicar</Botao>
      </div>
    </Cartao>
  );
}

function Abas({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  const itens = ['Visão geral', 'Publicações', 'Métricas'];
  return (
    <div style={{
      display: 'inline-flex', gap: px(3), padding: px(3), borderRadius: px(10),
      background: 'var(--p-s2)', border: '1px solid var(--p-bd)',
    }}>
      {itens.map((t, i) => (
        <span key={t} style={{
          fontSize: px(10.5), fontWeight: i === 0 ? 700 : 550,
          padding: `${px(5)} ${px(11)}`, borderRadius: px(7), whiteSpace: 'nowrap',
          background: i === 0 ? 'var(--p-s1)' : 'transparent',
          color: i === 0 ? 'var(--p-fg)' : 'var(--p-fg3)',
          boxShadow: i === 0 ? '0 1px 2px oklch(0 0 0 / .2)' : 'none',
        }}>{t}</span>
      ))}
    </div>
  );
}

/** Uma linha do Loop — a densidade real da tela mais carregada do produto. */
function LinhaLoop({ escala = 1 }) {
  const px = n => `${n * escala}px`;
  return (
    <Cartao escala={escala} estilo={{ borderLeft: '3px solid var(--p-success)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: px(9), flexWrap: 'wrap' }}>
        <span style={{
          width: px(26), height: px(26), borderRadius: 'var(--mf-r-full)', flexShrink: 0,
          background: 'var(--p-s3)', border: `2px solid var(--p-primary)`,
          display: 'grid', placeItems: 'center', fontSize: px(9), fontWeight: 750, color: 'var(--p-fg2)',
        }}>OP</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: px(11), fontWeight: 700, color: 'var(--p-fg)' }}>@oliviapaganini</div>
          <div style={{ fontSize: px(9.5), color: 'var(--p-fg3)' }}>Reel · 6 mídias · a cada 30 min</div>
        </div>
        <Selo tipo="success" escala={escala}><CircleCheck size={9 * escala} /> Saudável</Selo>
        <Pause size={13 * escala} style={{ color: 'var(--p-fg3)' }} />
      </div>
      <div style={{ display: 'flex', gap: px(4), marginTop: px(9) }}>
        {[1, 2, 3, 4, 5, 6].map(i => (
          <span key={i} style={{
            width: px(24), height: px(38), borderRadius: px(5), flexShrink: 0,
            background: `color-mix(in oklch, var(--p-c${(i % 5) + 1}) 26%, var(--p-s3))`,
            border: '1px solid var(--p-bd)',
          }} />
        ))}
      </div>
    </Cartao>
  );
}

/**
 * O fac-símile completo. `escala` encolhe tudo proporcionalmente para a
 * grade de comparação — encolher via `transform: scale` borraria o texto e
 * mentiria sobre a legibilidade, que é justamente o que se quer avaliar.
 */
function Vitrine({ paleta, tema, escala = 1, resumida = false }) {
  const modo = paleta[tema];
  const px = n => `${n * escala}px`;
  return (
    <div style={{
      ...tokensDe(modo),
      background: 'var(--p-bg)', color: 'var(--p-fg)',
      display: 'flex', minHeight: px(resumida ? 250 : 470),
      fontFamily: 'var(--mf-font, system-ui)',
    }}>
      <Sidebar escala={escala} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar escala={escala} />
        <div style={{ padding: px(14), display: 'flex', flexDirection: 'column', gap: px(11), minWidth: 0 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: px(10), flexWrap: 'wrap' }}>
            <div style={{ minWidth: px(140), flex: '1 1 auto' }}>
              <div style={{ fontSize: px(17), fontWeight: 750, color: 'var(--p-fg)', letterSpacing: '-.02em' }}>
                Campanhas
              </div>
              <div style={{ fontSize: px(10.5), color: 'var(--p-fg3)', marginTop: px(1) }}>
                Distribuição planejada
              </div>
            </div>
            <Botao variante="outline" escala={escala}>Exportar</Botao>
            <Botao variante="primary" escala={escala}><Plus size={12 * escala} /> Nova campanha</Botao>
          </div>

          <div style={{ display: 'grid', gap: px(10), gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 110px), 1fr))' }}>
            <Metrica rotulo="VIEWS TOTAIS" valor="284,7k" delta="+18,2%" cor="var(--p-success)" escala={escala} />
            <Metrica rotulo="ALCANCE" valor="96,4k" delta="+7,1%" cor="var(--p-success)" escala={escala} />
            <Metrica rotulo="PUBLICADOS" valor="1.204" delta="+3,4%" cor="var(--p-primary)" escala={escala} />
            {!resumida && <Metrica rotulo="NA FILA" valor="48" delta="+12" cor="var(--p-warning)" escala={escala} />}
          </div>

          <div style={{ display: 'grid', gap: px(10), gridTemplateColumns: resumida ? '1fr' : 'minmax(0, 1.65fr) minmax(0, 1fr)' }}>
            <Grafico escala={escala} />
            {!resumida && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: px(10), minWidth: 0 }}>
                <Notificacao escala={escala} />
                <LinhaLoop escala={escala} />
              </div>
            )}
          </div>

          {!resumida && (
            <>
              <div style={{ display: 'flex', gap: px(9), alignItems: 'center', flexWrap: 'wrap' }}>
                <Abas escala={escala} />
                <div style={{ flex: 1 }} />
                <Selo tipo="info" escala={escala}><Info size={9 * escala} /> Info</Selo>
                <Selo tipo="warning" escala={escala}><AlertTriangle size={9 * escala} /> Atenção</Selo>
                <Selo tipo="destructive" escala={escala}><X size={9 * escala} /> Erro</Selo>
                <Selo tipo="success" escala={escala}><Check size={9 * escala} /> Sucesso</Selo>
              </div>

              <div style={{ display: 'grid', gap: px(10), gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
                <Tabela escala={escala} />
                <Modal escala={escala} />
              </div>

              <Cartao escala={escala}>
                <div style={{ fontSize: px(10.5), fontWeight: 700, color: 'var(--p-fg)', marginBottom: px(10) }}>
                  Postar · formulário
                </div>
                <div style={{ display: 'grid', gap: px(9), gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))' }}>
                  <Campo rotulo="CONTA" valor="@oliviapaganini" tipo="select" escala={escala} />
                  <Campo rotulo="FORMATO" valor="Reel" tipo="select" escala={escala} />
                  <Campo rotulo="AGENDAR" valor="" escala={escala} />
                </div>
                <div style={{ display: 'flex', gap: px(7), marginTop: px(11), flexWrap: 'wrap' }}>
                  <Botao variante="primary" escala={escala}><Play size={11 * escala} /> Publicar agora</Botao>
                  <Botao variante="secondary" escala={escala}>Salvar rascunho</Botao>
                  <Botao variante="ghost" escala={escala}>Pré-visualizar</Botao>
                  <div style={{ flex: 1 }} />
                  <Botao variante="destructive" escala={escala}>Descartar</Botao>
                </div>
              </Cartao>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Aferição de contraste, ao vivo ───────────────────────────────────────
   A tabela de números fica ao lado da vitrine de propósito: paleta bonita que
   reprova em contraste não é candidata, e essa informação precisa estar na
   mesma tela onde a escolha acontece — não num relatório separado que
   ninguém abre na hora de decidir. */
function Aferição({ paleta, tema }) {
  const [linhas, setLinhas] = useState([]);
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!ctxRef.current) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      ctxRef.current = cv.getContext('2d', { willReadFrequently: true });
    }
    setLinhas(conferirContraste(paleta[tema], ctxRef.current));
  }, [paleta, tema]);

  const reprovam = linhas.filter(l => !l.passa);

  return (
    <div style={{
      background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', padding: 14, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 750, color: 'var(--mf-text)' }}>
          Contraste medido
        </span>
        <span style={{
          fontSize: 'var(--mf-t-nano)', fontWeight: 700,
          color: reprovam.length ? 'var(--mf-danger-500)' : 'var(--mf-success-500)',
        }}>
          {reprovam.length ? `${reprovam.length} reprovam` : 'tudo passa AA'}
        </span>
      </div>
      <div style={{ display: 'grid', gap: '2px 14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        {linhas.map(l => (
          <div key={l.nome} style={{
            display: 'flex', justifyContent: 'space-between', gap: 8,
            padding: '3px 0', fontSize: 'var(--mf-t-micro)',
            borderBottom: '1px solid var(--mf-border-subtle)',
          }}>
            <span style={{ color: 'var(--mf-text-3)' }}>{l.nome}</span>
            <span style={{
              fontFamily: 'var(--mf-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: l.passa ? 'var(--mf-text-2)' : 'var(--mf-danger-500)',
            }}>
              {l.razao.toFixed(2)}{l.passa ? '' : ` < ${l.minimo}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────────── */

export default function DesignSystemPreview() {
  const [tema, setTema] = useState('dark');
  const [foco, setFoco] = useState(PALETAS[0].id);
  const [escolhida, setEscolhida] = useState(() => {
    try { return localStorage.getItem(ARMAZEM) || null; } catch { return null; }
  });

  const paleta = useMemo(() => PALETAS.find(p => p.id === foco) || PALETAS[0], [foco]);

  function escolher(id) {
    setEscolhida(id);
    try { localStorage.setItem(ARMAZEM, id); } catch { /* modo privado */ }
  }

  const rotuloTema = tema === 'dark' ? 'Escuro' : 'Claro';

  return (
    <div style={{ padding: '20px 20px 48px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.2rem, 1rem + 0.9vw, 1.6rem)', fontWeight: 750, color: 'var(--mf-text)', letterSpacing: '-.025em' }}>
            Oito identidades
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', lineHeight: 1.6, maxWidth: '62ch' }}>
            Nenhuma está aplicada. Cada vitrine é o produto montado na densidade
            real — barra lateral, métrica, gráfico, tabela, estado — porque
            cartela de cores mente sobre como a paleta se comporta em uso.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
            {['dark', 'light'].map(t => (
              <button key={t} onClick={() => setTema(t)} style={{
                fontSize: 'var(--mf-t-micro)', fontWeight: 700, padding: '6px 14px', borderRadius: 'var(--mf-r-sm)',
                cursor: 'pointer', border: 'none', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                background: tema === t ? 'var(--mf-mod-contas)' : 'transparent',
                color: tema === t ? 'var(--mf-bg)' : 'var(--mf-text-3)',
              }}>{t === 'dark' ? 'Escuro' : 'Claro'}</button>
            ))}
          </div>
        </div>
      </div>

      {escolhida && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '11px 14px', borderRadius: 'var(--mf-r-md)',
          background: 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-success-500) 30%, transparent)',
        }}>
          <CircleCheck size={16} style={{ color: 'var(--mf-success-500)', flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)', minWidth: 0 }}>
            Marcada: <strong>{PALETAS.find(p => p.id === escolhida)?.nome}</strong>.
            {' '}<span style={{ color: 'var(--mf-text-3)' }}>
              Ainda não aplicada — diga “aplicar paleta {PALETAS.find(p => p.id === escolhida)?.nome}” quando decidir.
            </span>
          </span>
        </div>
      )}

      {/* Grade de comparação */}
      <div>
        <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: '.08em', marginBottom: 9 }}>
          AS OITO, LADO A LADO — {rotuloTema.toUpperCase()}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))' }}>
          {PALETAS.map(p => {
            const emFoco = p.id === foco;
            return (
              <button key={p.id} onClick={() => setFoco(p.id)} style={{
                padding: 0, borderRadius: 'var(--mf-r-lg)', overflow: 'hidden', cursor: 'pointer',
                textAlign: 'left', minWidth: 0, transition: 'transform .18s, box-shadow .18s',
                background: 'var(--mf-surface-1)',
                border: `2px solid ${emFoco ? 'var(--mf-mod-contas)' : 'var(--mf-border)'}`,
                transform: emFoco ? 'translateY(-2px)' : 'none',
                boxShadow: emFoco ? '0 8px 24px -8px color-mix(in oklch, var(--mf-mod-contas) 40%, transparent)' : 'none',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--mf-border)',
                }}>
                  <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 750, color: 'var(--mf-text)' }}>{p.nome}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {[p[tema].primary, p[tema].secondary, p[tema].accent].map((c, i) => (
                      <span key={i} style={{ width: 13, height: 13, borderRadius: 'var(--mf-r-xs)', background: c, border: '1px solid var(--mf-border)' }} />
                    ))}
                  </span>
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <Vitrine paleta={p} tema={tema} escala={0.82} resumida />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Foco */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--mf-t-h1)', fontWeight: 750, color: 'var(--mf-text)', letterSpacing: '-.02em' }}>
                {paleta.nome}
              </h2>
              <span style={{ fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                {paleta.id}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-2)', lineHeight: 1.65, maxWidth: '70ch' }}>
              {paleta.conceito}
            </p>
          </div>

          <button onClick={() => escolher(paleta.id)} className="btn btn-primary"
            style={{ flexShrink: 0, fontSize: 'var(--mf-t-sm)', padding: '9px 18px' }}>
            {escolhida === paleta.id ? '✓ Paleta marcada' : 'Usar esta paleta'}
          </button>
        </div>

        <div style={{ borderRadius: 'var(--mf-r-lg)', overflow: 'hidden', border: '1px solid var(--mf-border)' }}>
          <Vitrine paleta={paleta} tema={tema} escala={1} />
        </div>

        <Aferição paleta={paleta} tema={tema} />

        {/* Os valores, para quem quiser conferir número por número. */}
        <details style={{ background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding: '12px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text-2)' }}>
            Valores de {paleta.nome} · {rotuloTema.toLowerCase()}
          </summary>
          <div style={{ display: 'grid', gap: '3px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', marginTop: 11 }}>
            {Object.entries(paleta[tema]).filter(([, v]) => typeof v === 'string').map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-micro)', padding: '3px 0', minWidth: 0 }}>
                <span style={{ width: 14, height: 14, borderRadius: 'var(--mf-r-xs)', background: v, border: '1px solid var(--mf-border)', flexShrink: 0 }} />
                <span style={{ color: 'var(--mf-text-3)', minWidth: 88 }}>{k}</span>
                <span style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-nano)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
