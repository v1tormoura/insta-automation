import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import api from './api';

/**
 * A fila do Limpador, fora da tela.
 *
 * ── O defeito que isto corrige
 *
 * A fila vivia em `useState` dentro da página. Trocar de menu desmontava o
 * componente: os arquivos escolhidos sumiam, e um processamento em andamento
 * continuava rodando às cegas — o laço `for` sobrevive ao unmount, os
 * downloads ainda disparam, mas cada `setItems` cai num componente morto e,
 * ao voltar, a tela nasce vazia. A pessoa via a lista limpa e concluía que
 * "limpou tudo".
 *
 * Aqui a fila e o laço moram num módulo: sobrevivem à navegação. A página só
 * assina e desenha; o widget flutuante (LimpadorFlutuante) assina o mesmo
 * estado e mostra o progresso em qualquer tela.
 *
 * ── O que NÃO sobrevive
 *
 * Recarregar a página. `File` é um handle na memória do navegador — não dá
 * para guardar em localStorage. Por isso o aviso de `beforeunload` enquanto
 * roda: a pessoa decide, em vez de perder a fila sem saber.
 */

const LIMITE_BYTES = 500 * 1024 * 1024;

let estado = {
  items: [],            // [{ id, file, status, pct, error }]
  mode: 'limpeza_leve',
  wmPreset: 'auto',
  running: false,
};

const ouvintes = new Set();
function emitir() { for (const fn of ouvintes) fn(); }
function definir(patch) { estado = { ...estado, ...patch }; emitir(); }

function subscribe(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function getSnapshot() { return estado; }

/** Hook: a página e o widget leem o mesmo estado. */
export function useLimpador() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// estado por arquivo: 'waiting' | 'uploading' | 'processing' | 'done' | 'error'
function makeItem(f) {
  return { id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file: f, status: 'waiting', pct: 0, error: null };
}

export function updateItem(id, patch) {
  definir({ items: estado.items.map(it => (it.id === id ? { ...it, ...patch } : it)) });
}

export function addFiles(fileList) {
  const valid = [];
  for (const f of Array.from(fileList || [])) {
    if (f.size > LIMITE_BYTES) { toast.error(`${f.name}: máximo 500 MB.`); continue; }
    if (!f.type.startsWith('video/') && !f.type.startsWith('image/')) {
      toast.error(`${f.name}: tipo não suportado.`); continue;
    }
    valid.push(makeItem(f));
  }
  if (valid.length) definir({ items: [...estado.items, ...valid] });
}

export function removeItem(id) {
  definir({ items: estado.items.filter(it => it.id !== id) });
}

export function clearDone() {
  definir({ items: estado.items.filter(it => it.status !== 'done' && it.status !== 'error') });
}

export function setMode(mode)         { if (!estado.running) definir({ mode }); }
export function setWmPreset(wmPreset) { if (!estado.running) definir({ wmPreset }); }

async function processOne(item) {
  updateItem(item.id, { status: 'uploading', pct: 0, error: null });
  try {
    const { mode, wmPreset } = estado;
    const form = new FormData();
    form.append('file', item.file);
    form.append('mode', mode);
    if (mode === 'watermark') form.append('preset', wmPreset);

    const res = await api.post('/api/limpador/process', form, {
      responseType: 'blob',
      onUploadProgress: e => {
        const pct = e.total ? Math.round((e.loaded * 100) / e.total) : 0;
        updateItem(item.id, { pct, status: pct >= 100 ? 'processing' : 'uploading' });
      },
    });

    /* O download dispara pelo DOM, não pela página: funciona mesmo com o
       Limpador fechado — é o que faz "sair da tela" ser seguro. */
    const prefix = mode === 'watermark' ? 'sem_marca' : 'limpo';
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}_${item.file.name}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    updateItem(item.id, { status: 'done', pct: 100 });
  } catch (e) {
    let msg = e.message || 'Erro ao processar.';
    if (e.response?.data instanceof Blob) {
      try { const j = JSON.parse(await e.response.data.text()); msg = j.error || msg; } catch {}
    }
    updateItem(item.id, { status: 'error', error: msg });
  }
}

/* Aviso ao recarregar/fechar com a fila rodando. Os File não sobrevivem ao
   reload; a pessoa decide. Registrado uma vez, ativo só enquanto `running`. */
function avisarAoSair(ev) {
  if (!estado.running) return;
  ev.preventDefault();
  ev.returnValue = '';
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', avisarAoSair);

export async function processAll() {
  if (estado.running) return;
  const waiting = estado.items.filter(it => it.status === 'waiting' || it.status === 'error');
  if (!waiting.length) { toast.warning('Nenhum arquivo na fila.'); return; }
  definir({ running: true });
  try {
    for (const item of waiting) {
      /* Relê o item: pode ter sido removido da fila enquanto outro rodava. */
      if (!estado.items.some(it => it.id === item.id)) continue;
      await processOne(item);
    }
  } finally {
    definir({ running: false });
  }
  const erros = estado.items.filter(it => it.status === 'error').length;
  if (erros) toast.warning(`Fila concluída com ${erros} erro${erros === 1 ? '' : 's'}.`);
  else toast.success('Limpador: fila concluída!');
}

/** Resumo para o widget flutuante. */
export function resumo(s = estado) {
  const total = s.items.length;
  const feitos = s.items.filter(it => it.status === 'done').length;
  const erros = s.items.filter(it => it.status === 'error').length;
  const atual = s.items.find(it => it.status === 'uploading' || it.status === 'processing') || null;
  const pendentes = s.items.filter(it => it.status === 'waiting').length;
  return { total, feitos, erros, pendentes, atual };
}
