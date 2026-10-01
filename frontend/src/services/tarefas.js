import { useSyncExternalStore } from 'react';

/**
 * Tarefas em segundo plano que precisam sobreviver à troca de tela.
 *
 * Antes, o envio do Postar (e a importação) vivia dentro do componente: ao
 * sair da tela o upload seguia, mas a tela "esquecia" — voltava sem dizer que
 * estava enviando, restaurava o rascunho com as seleções antigas e, quando
 * acabava, ninguém limpava nada.
 *
 * Aqui o estado mora FORA das telas (um módulo, vivo enquanto a aba estiver
 * aberta): a tela que volta lê o progresso, o indicador flutuante mostra o que
 * está rodando em qualquer página, e o fim é entregue à tela uma vez só
 * (`consumir`) para ela limpar o formulário e avisar.
 *
 * Uma tarefa: { chave, rotulo, rota, fase: 'rodando'|'ok'|'erro',
 *               feitas, total, pct, etapa, mensagem, dados, id, consumida }
 */

const tarefas = new Map();
const ouvintes = new Set();
let lista = [];

function mudou() {
  lista = [...tarefas.values()];
  ouvintes.forEach(f => f());
}

function assinar(f) { ouvintes.add(f); return () => ouvintes.delete(f); }

export function obter(chave) { return tarefas.get(chave) || null; }

export function iniciar(chave, { rotulo, rota, total = 0, etapa = '', dados = {} } = {}) {
  tarefas.set(chave, { chave, rotulo, rota, fase: 'rodando', feitas: 0, total, pct: null, etapa, mensagem: '', dados, id: Date.now(), consumida: false });
  mudou();
}

export function progredir(chave, parcial) {
  const t = tarefas.get(chave);
  if (!t || t.fase !== 'rodando') return;
  tarefas.set(chave, { ...t, ...parcial });
  mudou();
}

export function concluir(chave, { mensagem = '', dados = {} } = {}) {
  const t = tarefas.get(chave);
  if (!t) return;
  tarefas.set(chave, { ...t, fase: 'ok', mensagem, dados: { ...t.dados, ...dados }, consumida: false });
  mudou();
}

export function falhar(chave, mensagem) {
  const t = tarefas.get(chave);
  if (!t) return;
  tarefas.set(chave, { ...t, fase: 'erro', mensagem, consumida: false });
  mudou();
}

/** A tela tratou o fim (limpou o formulário, avisou): não entrega de novo. */
export function consumir(chave) {
  const t = tarefas.get(chave);
  if (!t || t.fase === 'rodando') return;
  tarefas.delete(chave);
  mudou();
}

export const rodando = chave => tarefas.get(chave)?.fase === 'rodando';

/**
 * Roda `fn` como tarefa: o que ela devolve vira `dados` do fim; o erro vira a
 * mensagem. Não depende de nenhuma tela estar montada.
 */
export async function rodar(chave, meta, fn) {
  iniciar(chave, meta);
  try {
    const r = await fn(parcial => progredir(chave, parcial));
    concluir(chave, r || {});
    return r;
  } catch (err) {
    falhar(chave, err?.response?.data?.error || err?.message || 'Falhou.');
    throw err;
  }
}

export function useTarefa(chave) {
  return useSyncExternalStore(assinar, () => tarefas.get(chave) || null);
}

export function useTarefas() {
  return useSyncExternalStore(assinar, () => lista);
}

/* Fechar a aba no meio de um envio perde o envio: o navegador pergunta antes. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => {
    if ([...tarefas.values()].some(t => t.fase === 'rodando' && t.dados?.local)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
