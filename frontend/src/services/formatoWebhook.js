/** Formatação dos números do Webhook (página e cartão do Dashboard). */

export const fmtNum = n => Number(n || 0).toLocaleString('pt-BR');
export const real = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (a, b) => (b ? `${Math.round(((a || 0) / b) * 100)}%` : '—');
export const quando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function quandoFoi(d) {
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}
