import type { MetadataComparison, MetadataItem, MetadataSettings } from '@mediaforge/shared';
import { METADATA_CATEGORY_LABELS } from '@mediaforge/shared';

/** Valores com tamanho suficiente para busca nos bytes da saída. */
export function searchableValue(item: MetadataItem): string | null {
  const v = item.value.trim();
  if (v.length < 6 || v.startsWith('<') || /^[\d\s.,:-]+$/.test(v) && v.length < 10) return null;
  if (item.scope === 'bitstream') return null; // já é procurado pela assinatura
  return v.endsWith('…') ? null : v;
}

export function requestedFor(item: MetadataItem, meta: MetadataSettings | null): boolean {
  if (!meta || item.category === 'technical') return false;
  return meta.remove[item.category];
}

/**
 * Padrões a procurar nos bytes do arquivo de saída: valores textuais de
 * campos pedidos para remoção + assinaturas de bitstream quando a remoção
 * de SEI foi pedida.
 */
export function residualPatterns(before: MetadataItem[], meta: MetadataSettings): Array<{ itemId: string; pattern: Buffer }> {
  const out: Array<{ itemId: string; pattern: Buffer }> = [];
  for (const item of before) {
    if (!requestedFor(item, meta)) continue;
    const v = searchableValue(item);
    if (v) out.push({ itemId: item.id, pattern: Buffer.from(v, 'utf8') });
  }
  return out;
}

/**
 * Compara a inspeção de entrada com a de saída.
 * - removido: pedido e ausente da saída (e valor não encontrado nos bytes);
 * - substituído: pedido e presente com outro valor (ex.: padrão técnico do muxer);
 * - não comprovado: pedido e ainda presente, ou valor ainda encontrado nos bytes;
 * - preservado: não pedido e presente.
 */
export function compareMetadata(
  before: MetadataItem[],
  after: MetadataItem[],
  meta: MetadataSettings | null,
  residualFound: Set<string>,
  extraNotes: string[] = [],
): MetadataComparison {
  const afterById = new Map(after.map((i) => [i.id, i]));
  const matched = new Set<string>();
  const removed: MetadataComparison['removed'] = [];
  const preserved: MetadataComparison['preserved'] = [];
  const unverified: MetadataComparison['unverified'] = [];

  for (const item of before) {
    const requested = requestedFor(item, meta);
    const out = afterById.get(item.id);
    if (out) matched.add(out.id);

    if (item.category === 'technical') {
      if (out) preserved.push({ ...item, reason: 'Campo técnico do formato' });
      else removed.push({ ...item, how: 'ausente', requested: false });
      continue;
    }
    if (!requested) {
      if (out) {
        preserved.push({
          ...item,
          value: out.value,
          reason: out.value === item.value ? 'Mantido por escolha' : 'Mantido por escolha (valor regravado pelo processamento)',
        });
      } else {
        removed.push({ ...item, how: 'ausente', requested: false });
      }
      continue;
    }
    if (out && out.value === item.value) {
      unverified.push({ ...item, reason: 'Ainda presente na saída com o mesmo valor' });
    } else if (residualFound.has(item.id)) {
      unverified.push({ ...item, reason: 'O valor ainda foi encontrado nos bytes do arquivo de saída' });
    } else if (out) {
      removed.push({ ...item, how: 'substituido', requested: true, value: item.value, note: `Agora: ${out.value}` });
    } else {
      removed.push({ ...item, how: 'ausente', requested: true });
    }
  }

  const added = after.filter((i) => !matched.has(i.id));

  const requestedItems = before.filter((i) => requestedFor(i, meta));
  const anyCategory = !!meta && Object.values(meta.remove).some(Boolean);
  let verdict: MetadataComparison['verdict'];
  if (!anyCategory) verdict = 'nao-solicitado';
  else if (requestedItems.length === 0) verdict = 'nada-a-remover';
  else if (unverified.length === 0) verdict = 'comprovado';
  else if (unverified.length < requestedItems.length) verdict = 'parcial';
  else verdict = 'nao-comprovado';

  const notes = [
    'A verificação compara a inspeção da entrada e da saída (FFprobe, EXIF, XMP, IPTC, ICC, estrutura do contêiner) e procura os valores removidos nos bytes do arquivo gerado.',
    'Estruturas proprietárias que nenhuma dessas leituras reconhece podem não ser detectadas; nesse caso a remoção não pode ser comprovada.',
    ...extraNotes,
  ];
  if (added.some((a) => a.category !== 'technical' && a.sensitive)) {
    notes.push('A saída contém campos que não existiam na entrada (listados como adicionados).');
  }
  if (meta) {
    const kept = Object.entries(meta.remove)
      .filter(([, v]) => !v)
      .map(([k]) => METADATA_CATEGORY_LABELS[k as keyof typeof METADATA_CATEGORY_LABELS].label);
    if (kept.length) notes.push(`Categorias mantidas por escolha: ${kept.join(', ')}.`);
  }
  return { removed, preserved, unverified, added, verdict, notes };
}
