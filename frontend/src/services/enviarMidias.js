import api from './api';

/**
 * Envio de mídias para a biblioteca em lotes de até ~95 MB por requisição.
 *
 * Uma requisição só com dezenas de vídeos leva minutos e, se cair no meio,
 * perde tudo; em lotes, o que já subiu fica. Um arquivo maior que o lote vai
 * sozinho na sua própria requisição.
 */

export const LIMITE_POR_ENVIO = 95 * 1024 * 1024;

/** Agrupa na ordem recebida, sem passar do limite por lote. */
export function montarLotes(arquivos, limite = LIMITE_POR_ENVIO) {
  const lotes = [];
  let atual = [];
  let soma = 0;
  for (const f of arquivos) {
    if (atual.length && soma + f.size > limite) { lotes.push(atual); atual = []; soma = 0; }
    atual.push(f);
    soma += f.size;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/** @returns {Promise<object[]>} as mídias criadas, na ordem dos arquivos. */
/**
 * @param {(enviados: number, total: number) => void} [opts.aoProgredir] bytes enviados até agora, de todos os lotes
 */
export async function enviarMidias(arquivos, { folder, aoProgredir } = {}) {
  const media = [];
  const lista = Array.from(arquivos || []);
  const total = lista.reduce((s, f) => s + (f.size || 0), 0);
  let jaFoi = 0;
  for (const lote of montarLotes(lista)) {
    const form = new FormData();
    lote.forEach(f => form.append('media', f));
    if (folder) form.append('folder', folder);
    const { data } = await api.post('/media/upload', form, {
      onUploadProgress: e => aoProgredir?.(jaFoi + Math.min(e.loaded, e.total || e.loaded), total),
    });
    jaFoi += lote.reduce((s, f) => s + (f.size || 0), 0);
    aoProgredir?.(jaFoi, total);
    media.push(...(data?.media || data?.files || []));
  }
  return media;
}
