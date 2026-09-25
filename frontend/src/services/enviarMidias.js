import api from './api';

/**
 * Envio de mídias para a biblioteca em lotes.
 *
 * A API fica atrás da Cloudflare, que recusa (413) requisição acima de 100 MB
 * nos planos Free e Pro. Um envio único com vários vídeos passaria disso fácil;
 * em lotes de até 95 MB cada requisição cabe. Um arquivo sozinho acima do
 * limite não tem como passar — volta em `recusados` para a tela avisar.
 */

export const LIMITE_POR_ENVIO = 95 * 1024 * 1024;

export const tamanhoLegivel = bytes => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Agrupa na ordem recebida, sem passar do limite por lote. */
export function montarLotes(arquivos, limite = LIMITE_POR_ENVIO) {
  const lotes = [];
  const recusados = [];
  let atual = [];
  let soma = 0;
  for (const f of arquivos) {
    if (f.size > limite) { recusados.push(f); continue; }
    if (atual.length && soma + f.size > limite) { lotes.push(atual); atual = []; soma = 0; }
    atual.push(f);
    soma += f.size;
  }
  if (atual.length) lotes.push(atual);
  return { lotes, recusados };
}

/** @returns {Promise<{ media: object[], recusados: File[] }>} as mídias criadas, na ordem dos arquivos. */
export async function enviarMidias(arquivos, { folder } = {}) {
  const { lotes, recusados } = montarLotes(Array.from(arquivos || []));
  const media = [];
  for (const lote of lotes) {
    const form = new FormData();
    lote.forEach(f => form.append('media', f));
    if (folder) form.append('folder', folder);
    const { data } = await api.post('/media/upload', form);
    media.push(...(data?.media || data?.files || []));
  }
  return { media, recusados };
}

/** Texto do aviso para arquivos que não cabem num envio. */
export function avisoDeRecusados(recusados) {
  if (!recusados.length) return '';
  const nomes = recusados.map(f => `${f.name} (${tamanhoLegivel(f.size)})`).join(', ');
  return `Acima de ${tamanhoLegivel(LIMITE_POR_ENVIO)} por arquivo não passa pela Cloudflare: ${nomes}. Comprima e envie de novo.`;
}
