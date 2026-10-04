import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Webhook, ChevronRight } from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { fmtNum, real, pct, quandoFoi } from '../services/formatoWebhook';

/**
 * Webhook no Dashboard: hoje e os últimos 7 dias do bot de vendas — leads,
 * cliques em comprar, vendas, receita — e a receita diária em barrinhas.
 * Some quando o webhook nunca recebeu nada (não ocupa espaço à toa).
 */
export default function ResumoDoWebhook() {
  const [r, setR] = useState(null);
  const carregar = useCallback(() => {
    api.get('/funil/resumo', { params: { dias: 7 } }).then(x => setR(x.data)).catch(() => setR(null));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useServerEvents(['funil'], () => carregar());

  if (!r || !r.ultimoEvento) return null;
  const h = r.hoje || {};
  const e = r.etapas || {};
  const max = Math.max(1, ...(r.serie || []).map(d => d.receita));
  const itens = [
    ['Leads', fmtNum(h.entrou), `${fmtNum(e.entrou)} em 7 dias`],
    ['Clicaram em comprar', fmtNum(h.checkout), `${fmtNum(e.checkout)} em 7 dias`],
    ['Vendas', fmtNum(h.comprou), `${fmtNum(e.comprou)} em 7 dias · ${pct(e.comprou, e.entrou)} conv.`],
    ['Receita', real(h.receita), `${real(r.receita)} em 7 dias`],
  ];

  return (
    <section className="mf-card" data-resumo-webhook style={{ padding: 'var(--mf-4)', borderRadius: 'var(--mf-r-xl)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--mf-3)', flexWrap: 'wrap' }}>
        <span style={{ width: 30, height: 30, borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center',
          background: 'color-mix(in oklch, var(--mf-primary-500) 14%, transparent)', color: 'var(--mf-primary-500)' }}><Webhook size={16} /></span>
        <div>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Vendas do bot · hoje</div>
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>último evento {quandoFoi(r.ultimoEvento)}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Link to="/webhook" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-primary-500)', textDecoration: 'none' }}>
          Abrir Webhook <ChevronRight size={14} />
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 'var(--mf-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr)) minmax(180px, 1.3fr)', alignItems: 'end' }}>
        {itens.map(([rot, val, sub]) => (
          <div key={rot} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)' }}>{rot}</div>
            <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, marginTop: 2 }}>{val}</div>
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{sub}</div>
          </div>
        ))}
        <div title="Receita dos últimos 7 dias" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
          {(r.serie || []).map(d => (
            <div key={d.dia} title={`${new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}: ${real(d.receita)} · ${d.comprou} venda(s)`}
              style={{ flex: 1, height: d.receita ? `${Math.max(6, (d.receita / max) * 100)}%` : 3, borderRadius: '3px 3px 0 0',
                background: d.receita ? 'var(--mf-primary-500)' : 'var(--mf-border)' }} />
          ))}
        </div>
      </div>
    </section>
  );
}
