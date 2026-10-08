import { useSyncExternalStore } from 'react';
import api from './api';
import * as tarefas from './tarefas';

/**
 * Envio dos arquivos das Variações de Mídia.
 *
 * Mora fora da tela (como o envio do Postar): trocar de página não interrompe
 * o upload, o indicador flutuante mostra o andamento em qualquer tela, e
 * fechar a aba no meio pergunta antes (tarefas.js, `dados.local`).
 *
 * Um arquivo por requisição, dois por vez: cada um tem o próprio progresso e
 * pode ser cancelado sozinho, e um arquivo ruim não derruba os outros.
 *
 * Um item: { chave, nome, bytes, tipo, lote, pct, fase, erro }
 *   fase: 'esperando' | 'enviando' | 'ok' | 'erro' | 'cancelado'
 */

const CHAVE_TAREFA = 'variacoes';
const SIMULTANEOS = 2;

const itens = new Map();
const arquivos = new Map();   // chave → File (fora do estado: não precisa re-renderizar)
const controles = new Map();  // chave → AbortController
const ouvintes = new Set();
let lista = [];
let rodando = 0;

function mudou() {
  lista = [...itens.values()];
  ouvintes.forEach(f => f());
  const ativos = lista.filter(i => i.fase === 'esperando' || i.fase === 'enviando');
  if (ativos.length) {
    const bytes = lista.reduce((s, i) => s + (i.fase === 'cancelado' ? 0 : i.bytes), 0) || 1;
    const enviados = lista.reduce((s, i) => s + (i.fase === 'cancelado' ? 0 : i.bytes * (i.pct || 0) / 100), 0);
    const feitas = lista.filter(i => ['ok', 'erro', 'cancelado'].includes(i.fase)).length;
    tarefas.progredir(CHAVE_TAREFA, { feitas, total: lista.length, pct: Math.round((enviados / bytes) * 100), etapa: `Enviando ${feitas + 1} de ${lista.length}` });
  }
}

function atualizar(chave, parcial) {
  const i = itens.get(chave);
  if (!i) return;
  itens.set(chave, { ...i, ...parcial });
  mudou();
}

function terminarSeAcabou() {
  if (lista.some(i => i.fase === 'esperando' || i.fase === 'enviando')) return;
  if (!tarefas.rodando(CHAVE_TAREFA)) return;
  const ok = lista.filter(i => i.fase === 'ok').length;
  const erros = lista.filter(i => i.fase === 'erro').length;
  tarefas.concluir(CHAVE_TAREFA, {
    mensagem: `${ok} arquivo(s) enviado(s) para processar${erros ? ` · ${erros} com erro` : ''}`,
    dados: { ok, erros, local: false },
  });
  // Os enviados saem da lista em instantes (já aparecem nos resultados); os erros ficam.
  setTimeout(() => {
    for (const [k, i] of itens) if (i.fase === 'ok' || i.fase === 'cancelado') { itens.delete(k); arquivos.delete(k); }
    mudou();
  }, 2500);
}

async function enviarUm(item) {
  const controle = new AbortController();
  controles.set(item.chave, controle);
  atualizar(item.chave, { fase: 'enviando', pct: 0 });
  const fd = new FormData();
  fd.append('lote', item.lote);
  fd.append('config', JSON.stringify(item.config));
  fd.append('arquivo', arquivos.get(item.chave), item.nome);
  try {
    await api.post('/preparos/arquivos', fd, {
      signal: controle.signal,
      timeout: 0,
      onUploadProgress: e => { if (e.total) atualizar(item.chave, { pct: Math.min(99, Math.round((e.loaded / e.total) * 100)) }); },
    });
    atualizar(item.chave, { fase: 'ok', pct: 100 });
  } catch (err) {
    if (controle.signal.aborted) atualizar(item.chave, { fase: 'cancelado' });
    else atualizar(item.chave, { fase: 'erro', erro: err.response?.data?.error || (err.message === 'Network Error' ? 'Conexão caiu durante o envio.' : err.message) });
  } finally {
    controles.delete(item.chave);
  }
}

function bombear() {
  while (rodando < SIMULTANEOS) {
    const prox = lista.find(i => i.fase === 'esperando');
    if (!prox) break;
    rodando++;
    itens.set(prox.chave, { ...prox, fase: 'enviando' });
    enviarUm(prox).finally(() => { rodando--; bombear(); terminarSeAcabou(); });
  }
  mudou();
}

/**
 * Põe os arquivos na fila de envio. `arquivosLocais`: [{ file, tipo }].
 * Devolve o id do lote (os arquivos deste clique saem juntos no "último envio").
 */
export function enviar(arquivosLocais, config) {
  const lote = crypto.randomUUID();
  if (!tarefas.rodando(CHAVE_TAREFA)) {
    tarefas.iniciar(CHAVE_TAREFA, { rotulo: 'Variações de Mídia', rota: '/variacoes', total: arquivosLocais.length, etapa: 'Enviando', dados: { local: true } });
  }
  for (const { file, tipo } of arquivosLocais) {
    const chave = crypto.randomUUID();
    arquivos.set(chave, file);
    itens.set(chave, { chave, nome: file.name, bytes: file.size, tipo, lote, config, pct: 0, fase: 'esperando', erro: '' });
  }
  mudou();
  bombear();
  return lote;
}

export function cancelar(chave) {
  const i = itens.get(chave);
  if (!i) return;
  if (i.fase === 'esperando') { atualizar(chave, { fase: 'cancelado' }); terminarSeAcabou(); }
  else if (i.fase === 'enviando') controles.get(chave)?.abort();
}

export function cancelarTodos() {
  for (const i of lista) cancelar(i.chave);
}

/** Tira da lista os que já terminaram (inclusive os com erro). */
export function limparFinalizados() {
  for (const [k, i] of itens) if (!['esperando', 'enviando'].includes(i.fase)) { itens.delete(k); arquivos.delete(k); }
  mudou();
}

function assinar(f) { ouvintes.add(f); return () => ouvintes.delete(f); }
export function useEnvios() {
  return useSyncExternalStore(assinar, () => lista);
}
