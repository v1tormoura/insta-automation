import { getToken } from './auth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Link de download de um item da Biblioteca (`remover`: some da Biblioteca depois de baixado). */
export const linkDeDownload = (id, remover) =>
  `${API_URL}/importar/baixar/${id}?token=${encodeURIComponent(getToken() || '')}${remover ? '&remover=1' : ''}`;

/** Dispara os downloads, um a um, com uma folga para o navegador não barrar. */
export async function baixarTodos(arquivos, remover) {
  for (const a of arquivos) {
    const link = document.createElement('a');
    link.href = linkDeDownload(a.id, remover);
    link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    await new Promise(r => setTimeout(r, 900));
  }
}
