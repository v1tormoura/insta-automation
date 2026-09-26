import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR');

/** 1.284 / 12,9 mil / 4,2 mi — para números de destaque. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.abs(n) >= 10_000 ? compact.format(n) : full.format(n);
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : full.format(n);
}

export function formatPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const time = format(d, 'HH:mm');
  if (isToday(d)) return `Hoje, ${time}`;
  if (isTomorrow(d)) return `Amanhã, ${time}`;
  if (isYesterday(d)) return `Ontem, ${time}`;
  return format(d, "d 'de' MMM, HH:mm", { locale: ptBR });
}

export function formatDate(iso: string): string {
  return format(new Date(iso), "d 'de' MMM yyyy", { locale: ptBR });
}

export function formatShortDay(isoDate: string): string {
  // "2026-09-20" é uma data de calendário; interpretar como meio-dia evita virar o dia no fuso.
  return format(new Date(`${isoDate}T12:00:00`), 'dd/MM');
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const past = d.getTime() <= Date.now();
  const dist = formatDistanceToNowStrict(d, { locale: ptBR });
  return past ? `há ${dist}` : `em ${dist}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(min: number): string {
  if (min === 0) return 'sem intervalo';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

/** Valor para <input type="datetime-local"> no fuso do navegador. */
export function toLocalInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
