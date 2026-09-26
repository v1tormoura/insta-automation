import { toast } from 'sonner';

/**
 * O aviso das ações do painel ("Salvo", "Não deu para enviar"…), num lugar só.
 *
 * Título + detalhe opcional. Erro fica mais tempo na tela: é o que a pessoa
 * precisa ler até o fim para saber o que fazer. Os marcos e eventos da Central
 * (SmartActivity) são outra coisa e têm a pilha própria no topo.
 */
const DURACAO = { success: 4000, info: 4500, warning: 6500, error: 8000 };

export function avisar(tipo, titulo, detalhe) {
  const t = ['success', 'error', 'warning', 'info'].includes(tipo) ? tipo : 'success';
  const texto = String(titulo || detalhe || '').trim();
  if (!texto) return;
  const opcoes = { duration: DURACAO[t] };
  if (titulo && detalhe) opcoes.description = String(detalhe);
  toast[t](texto, opcoes);
}
