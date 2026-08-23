/**
 * Componentes-base do design system proposto.
 *
 * Regra que rege o arquivo: nenhum componente escolhe cor. Ele recebe uma
 * INTENÇÃO — `tom="success"`, `modulo="campanhas"` — e o sistema resolve o
 * valor. É o que impede o problema atual, em que cada tela inventou o próprio
 * verde e a interface passou a parecer feita por gente diferente.
 */
import { MODULOS, STATUS } from './dados';

/* ── Cabeçalho de página ─────────────────────────────────────────────────*/
export function PageHeader({ titulo, sub, modulo = 'sistema', acoes }) {
  return (
    <header className="mf-page-head" style={{ '--mf-mod': MODULOS[modulo] }}>
      <div className="mf-page-head__txt">
        <h1 className="mf-page-head__t">
          <span className="mf-page-head__dot" aria-hidden="true" />
          <span className="mf-trunc">{titulo}</span>
        </h1>
        {sub && <p className="mf-page-head__s">{sub}</p>}
      </div>
      {acoes && <div className="mf-page-head__acts">{acoes}</div>}
    </header>
  );
}

/* ── Botão ───────────────────────────────────────────────────────────────*/
export function Botao({
  variante = 'secondary', tamanho, carregando, children, iconeSo, ...resto
}) {
  const classes = [
    'mf-btn', `mf-btn--${variante}`,
    tamanho === 'sm' ? 'mf-btn--sm' : '',
    iconeSo ? 'mf-btn--icon' : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={carregando || resto.disabled} {...resto}>
      {carregando && <span className="mf-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────*/
export function Card({ titulo, sub, acoes, children, hover, semCorpo }) {
  return (
    <section className={`mf-card${hover ? ' mf-card--hover' : ''}`}>
      {(titulo || acoes) && (
        <div className="mf-card__head">
          <div className="mf-trunc">
            {titulo && <h2 className="mf-card__title mf-trunc">{titulo}</h2>}
            {sub && <p className="mf-card__sub mf-trunc">{sub}</p>}
          </div>
          {acoes}
        </div>
      )}
      {semCorpo ? children : <div className="mf-card__body">{children}</div>}
    </section>
  );
}

/* ── KPI ─────────────────────────────────────────────────────────────────
   Valor, tendência e micrográfico juntos. Número solto não informa: 184K é
   bom ou ruim? A variação e a linha respondem antes da pergunta. */
export function KpiCard({ label, valor, delta, vs, modulo = 'metricas', serie = [], icone }) {
  const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const seta = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';

  return (
    <article className="mf-card mf-card--hover" style={{ '--mf-mod': MODULOS[modulo] }}>
      <div className="mf-kpi">
        <div className="mf-kpi__top">
          <span className="mf-kpi__label">{label}</span>
          {icone && <span className="mf-kpi__ico" aria-hidden="true">{icone}</span>}
        </div>
        <div className="mf-kpi__value">{valor}</div>
        <div className="mf-kpi__foot">
          <span className="mf-trend" data-dir={dir}>
            {seta} {Math.abs(delta).toFixed(1)}%
          </span>
          <span className="mf-kpi__vs">{vs}</span>
        </div>
      </div>
      {serie.length > 0 && <Sparkline pontos={serie} />}
    </article>
  );
}

/**
 * Micrográfico em SVG puro.
 *
 * Sem biblioteca de propósito: são 14 pontos numa linha de 40px de altura.
 * Montar um <ResponsiveContainer> do recharts para isso custaria mais em
 * runtime do que o gráfico inteiro entrega.
 */
function Sparkline({ pontos }) {
  const max = Math.max(...pontos), min = Math.min(...pontos);
  const faixa = max - min || 1;
  const d = pontos
    .map((p, i) => `${(i / (pontos.length - 1)) * 100},${34 - ((p - min) / faixa) * 28}`)
    .join(' L ');

  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"
      style={{ width: '100%', height: 40, display: 'block' }}>
      <defs>
        <linearGradient id={`mf-spark-${pontos[0]}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--mf-mod)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--mf-mod)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${d} L 100,40 L 0,40 Z`} fill={`url(#mf-spark-${pontos[0]})`} />
      <path d={`M ${d}`} fill="none" stroke="var(--mf-mod)" strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Selo de estado ──────────────────────────────────────────────────────*/
export function Selo({ estado, children, tom }) {
  const s = STATUS[estado];
  return (
    <span className="mf-badge" data-tone={tom || s?.tom}>
      <span className="mf-badge__dot" aria-hidden="true" />
      {children || s?.rotulo || estado}
    </span>
  );
}

/* ── Estado vazio ────────────────────────────────────────────────────────
   Nunca "Nenhum dado". Um vazio bem feito diz o que aquilo seria, por que
   está vazio e qual é o próximo passo. */
export function Vazio({ icone, titulo, descricao, acao, modulo = 'sistema' }) {
  return (
    <div className="mf-empty" style={{ '--mf-mod': MODULOS[modulo] }}>
      <div className="mf-empty__ico" aria-hidden="true">{icone}</div>
      <h3 className="mf-empty__t">{titulo}</h3>
      <p className="mf-empty__d">{descricao}</p>
      {acao}
    </div>
  );
}

/* ── Esqueleto ───────────────────────────────────────────────────────────*/
export function Skel({ h = 14, w = '100%', style }) {
  return <div className="mf-skel" style={{ height: h, width: w, ...style }} />;
}

export function KpiSkeleton() {
  return (
    <article className="mf-card">
      <div className="mf-kpi">
        <div className="mf-kpi__top"><Skel h={10} w={90} /><Skel h={26} w={26} /></div>
        <Skel h={30} w="60%" />
        <div className="mf-kpi__foot"><Skel h={11} w={54} /><Skel h={11} w={70} /></div>
      </div>
      <Skel h={40} style={{ borderRadius: 0 }} />
    </article>
  );
}

/* ── Barra de progresso ──────────────────────────────────────────────────*/
export function Progresso({ valor, rotulo }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {rotulo && (
        <div className="mf-row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>{rotulo}</span>
          <span className="mf-mono" style={{ fontSize: 'var(--mf-t-xs)' }}>{valor}%</span>
        </div>
      )}
      <div className="mf-prog" role="progressbar" aria-valuenow={valor} aria-valuemin={0} aria-valuemax={100}>
        <div className="mf-prog__fill" style={{ width: `${valor}%` }} />
      </div>
    </div>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────────────
   Iniciais sobre matiz derivado do próprio nome: cada conta ganha uma cor
   estável, sem precisar de imagem nem de campo novo no banco. */
export function Avatar({ nome, tamanho = 34 }) {
  const iniciais = String(nome || '?').replace(/[^a-zA-ZÀ-ú]/g, ' ').trim()
    .split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const matiz = [...String(nome)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

  return (
    <span aria-hidden="true" style={{
      width: tamanho, height: tamanho, borderRadius: 'var(--mf-r-full)', flexShrink: 0,
      display: 'grid', placeItems: 'center',
      fontSize: tamanho * 0.36, fontWeight: 700, letterSpacing: '-0.02em',
      background: `oklch(0.30 0.06 ${matiz})`,
      color: `oklch(0.86 0.14 ${matiz})`,
      border: '1px solid oklch(1 0 0 / 0.10)',
    }}>{iniciais}</span>
  );
}

/* ── Etapas ──────────────────────────────────────────────────────────────*/
export function Etapas({ etapas, atual }) {
  return (
    <nav className="mf-steps" aria-label="Etapas da campanha">
      {etapas.map((e, i) => {
        const estado = i < atual ? 'done' : i === atual ? 'current' : 'todo';
        return (
          <div key={e} className="mf-step" data-state={estado}
            aria-current={estado === 'current' ? 'step' : undefined}>
            <div className="mf-step__n">
              {estado === 'done' ? '✓ FEITO' : `ETAPA ${String(i + 1).padStart(2, '0')}`}
            </div>
            <div className="mf-step__t">{e}</div>
          </div>
        );
      })}
    </nav>
  );
}
