import { useLocation, useNavigate } from 'react-router-dom';
import { useLimpador, resumo } from '../services/limpadorStore';
import PortalModal from './PortalModal';

/**
 * O Limpador visível de qualquer tela.
 *
 * Aparece quando há fila (rodando ou aguardando) e a pessoa NÃO está no
 * Limpador — lá a própria página já mostra tudo. Clique leva de volta.
 *
 * Fica no rodapé direito, acima de qualquer conteúdo, sem roubar o clique
 * de nada ao redor: é um botão pequeno, não uma faixa.
 */
export default function LimpadorFlutuante() {
  const s = useLimpador();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (pathname.startsWith('/limpador')) return null;
  const r = resumo(s);
  if (!s.running && r.pendentes === 0) return null;

  const pct = r.atual ? r.atual.pct : 0;
  const rotulo = s.running
    ? (r.atual
        ? `${r.atual.status === 'uploading' ? 'Enviando' : 'Processando'} ${r.atual.file.name}`
        : 'Processando…')
    : `${r.pendentes} arquivo${r.pendentes === 1 ? '' : 's'} na fila, sem processar`;

  /* Em <body>, pelo mesmo motivo dos modais: position:fixed dentro da casca
     do app fica preso a um ancestral com container-type/transform. */
  return (
    <PortalModal>
    <style>{`@keyframes limpador-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    <button
      type="button"
      onClick={() => navigate('/limpador')}
      title="Abrir o Limpador"
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 1500,
        maxWidth: 'min(360px, calc(100vw - 32px))',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 'var(--mf-r-lg)',
        background: 'color-mix(in oklch, var(--mf-surface-1) 92%, transparent)',
        border: '1px solid var(--mf-border)', boxShadow: 'var(--mf-shadow-2, 0 8px 24px rgba(0,0,0,.35))',
        backdropFilter: 'blur(12px)', color: 'var(--mf-text)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: s.running ? 'var(--mf-primary-500)' : 'var(--mf-warning-500)',
        boxShadow: s.running ? '0 0 0 4px color-mix(in oklch, var(--mf-primary-500) 25%, transparent)' : 'none',
        animation: s.running ? 'limpador-pulse 1.5s infinite' : 'none' }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mf-text-3)' }}>
          Limpador · {r.feitos}/{r.total}{r.erros ? ` · ${r.erros} erro${r.erros === 1 ? '' : 's'}` : ''}
        </span>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-xs)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rotulo}
        </span>
        {s.running && (
          <span style={{ display: 'block', height: 3, marginTop: 6, borderRadius: 2, background: 'color-mix(in oklch, var(--mf-border) 70%, transparent)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--mf-primary-500)', transition: 'width .25s' }} />
          </span>
        )}
      </span>
      <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', flexShrink: 0 }}>ver ›</span>
    </button>
    </PortalModal>
  );
}
