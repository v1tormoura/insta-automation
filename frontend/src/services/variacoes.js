/**
 * Variações de Mídia — as contas da tela, sem React (testáveis sozinhas).
 */

export const FORMATOS = [
  { id: '9x16', rotulo: 'Reels / Stories', proporcao: '9:16', largura: 1080, altura: 1920 },
  { id: '4x5', rotulo: 'Feed', proporcao: '4:5', largura: 1080, altura: 1350 },
  { id: '1x1', rotulo: 'Quadrado', proporcao: '1:1', largura: 1080, altura: 1080 },
  { id: 'original', rotulo: 'Original', proporcao: 'mesma', largura: null, altura: null },
];

export const CONFIG_PADRAO = {
  modo: 'rapido',
  aplicarEm: 'tudo',
  formatos: ['9x16'],
  enquadramento: 'cortar',
  qualidade: 'alta',
  formatoFoto: 'jpg',
  larguraOriginal: 1080,
  semAudio: false,
  realce: false,
  /* Upscale até 4K/8K (com o realce) e IA nas fotos — só no avançado. */
  resolucao: 'padrao',
  ia: 'desligado',
  trecho: { inicio: 0, fim: null },
  ajustes: { brilho: 0, contraste: 0, saturacao: 0, nitidez: 0 },
  /* Ligado por padrão: vídeo de fala sem as pausas. */
  silencios: 'normal',
  capa: { ativa: false, segundo: null, titulo: '', posicao: 'centro' },
  logo: { ativa: false, canto: 'sup-dir', tamanho: 'medio', opacidade: 90 },
};

export const SILENCIOS = [
  { value: 'desligado', label: 'Desligado', texto: 'O vídeo sai com todas as pausas.' },
  { value: 'suave', label: 'Suave', texto: 'Tira só as pausas longas (mais de 1 segundo).' },
  { value: 'normal', label: 'Normal', texto: 'Tira as pausas de mais de 0,6 s entre as frases.' },
  { value: 'forte', label: 'Forte', texto: 'Tira até as pausas curtas (0,35 s) — ritmo bem acelerado.' },
];
export const CANTOS_LOGO = [
  { value: 'sup-esq', label: '↖' }, { value: 'sup-dir', label: '↗' },
  { value: 'inf-esq', label: '↙' }, { value: 'inf-dir', label: '↘' },
];
export const FRACAO_LOGO = { pequeno: 0.13, medio: 0.18, grande: 0.25 }; // espelha marcaDagua.js

/* Resolução do upscale: quantas vezes a base de 1080 do formato (espelha preparoDeMidia.js). */
export const RESOLUCOES = [
  { value: 'padrao', label: 'Full HD', fator: 1 },
  { value: '2160', label: '4K', fator: 2 },
  { value: '4320', label: '8K', fator: 4 },
];
export const MODOS_IA = [
  { value: 'desligado', label: 'Desligada' },
  { value: 'rapida', label: 'IA rápida', texto: 'segundos por foto' },
  { value: 'maxima', label: 'IA máxima', texto: 'minutos por foto' },
];
/** Quantas vezes a base de 1080 a saída terá (1 sem realce). */
export function fatorDaResolucao(config) {
  if (config.modo !== 'avancado' || !config.realce) return 1;
  return RESOLUCOES.find(r => r.value === config.resolucao)?.fator || 1;
}

const EXT_VIDEO = /\.(mp4|mov|m4v)$/i;
const EXT_FOTO = /\.(jpe?g|png|webp)$/i;

/** 'video' | 'imagem' | null, pelo tipo e pela extensão do arquivo local. */
export function tipoLocal(arquivo) {
  const nome = arquivo?.name || '';
  if (/^video\//.test(arquivo?.type || '') || EXT_VIDEO.test(nome)) return 'video';
  if (/^image\/(jpeg|png|webp)$/.test(arquivo?.type || '') || EXT_FOTO.test(nome)) return 'imagem';
  return null;
}

/**
 * O problema de um arquivo antes de enviar, ou ''. A palavra final é do
 * servidor (que confere o conteúdo); aqui só se evita mandar o óbvio.
 */
export function problemaLocal(arquivo, { aplicarEm = 'tudo', limites = {}, duracao = null } = {}) {
  const tipo = tipoLocal(arquivo);
  if (!tipo) return 'Formato não suportado (use MP4, MOV, JPG, PNG ou WEBP).';
  if (aplicarEm === 'video' && tipo !== 'video') return 'Configurado para processar só vídeos.';
  if (aplicarEm === 'imagem' && tipo !== 'imagem') return 'Configurado para processar só fotos.';
  const maxMb = tipo === 'video' ? limites.videoMb : limites.imagemMb;
  if (maxMb && arquivo.size > maxMb * 1024 * 1024) return `Maior que ${maxMb} MB.`;
  if (tipo === 'video' && duracao && limites.duracaoS && duracao > limites.duracaoS) return `Mais de ${Math.round(limites.duracaoS / 60)} min.`;
  return '';
}

/** Segundos de vídeo que serão processados, respeitando o trecho escolhido. */
export function duracaoUtil(duracao, config) {
  if (!duracao) return 0;
  if (config.modo !== 'avancado') return duracao;
  const inicio = Math.min(duracao, Math.max(0, Number(config.trecho?.inicio) || 0));
  const fim = config.trecho?.fim == null || config.trecho.fim === '' ? duracao : Math.min(duracao, Number(config.trecho.fim));
  return Math.max(0, fim - inicio);
}

const FATOR = { alta: 0.9, media: 0.7, leve: 0.4 }; // segundos de processamento por segundo de vídeo, por formato

/**
 * Estimativa grosseira do tempo de processamento, em segundos. É uma ordem de
 * grandeza (o servidor processa 2 por vez, e a máquina varia) — a tela diz isso.
 */
const SEGUNDOS_IA = { rapida: 15, maxima: 120 }; // por foto; a IA faz uma de cada vez no servidor

export function estimarSegundos(itens, config) {
  const n = Math.max(1, config.formatos.length);
  const k = fatorDaResolucao(config);
  /* Realce: codificação mais caprichada (~2x); 4K tem 4x os pixels, 8K 16x. */
  const fator = (FATOR[config.qualidade] || 0.9) * (config.enquadramento === 'desfoque' ? 1.4 : 1)
    * (config.modo === 'avancado' && config.realce ? 2 * k * k : 1);
  const ia = config.modo === 'avancado' ? SEGUNDOS_IA[config.ia] || 0 : 0;
  /* O corte de pausas lê o áudio e gera um intermediário antes dos formatos. */
  const extraPausas = config.silencios && config.silencios !== 'desligado' ? 0.6 : 0;
  let total = 0, daIA = 0;
  for (const it of itens) {
    if (it.tipo === 'video') total += (3 + duracaoUtil(it.duracao || 30, config) * fator) * n + duracaoUtil(it.duracao || 30, config) * extraPausas;
    else { total += 1.5 * n * k * k; daIA += ia; }
  }
  return Math.round(total / 2 + daIA); // 2 arquivos ao mesmo tempo no servidor; a IA, um de cada vez
}

export function tempoLegivel(seg) {
  if (seg < 60) return `${Math.max(5, Math.round(seg / 5) * 5)} s`;
  const min = Math.round(seg / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function tamanho(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** O que vai acontecer com cada arquivo, em uma linha, para a tela mostrar antes de começar. */
export function resumoDaConfig(config) {
  const partes = [];
  const fmts = config.formatos.map(id => FORMATOS.find(f => f.id === id)).filter(Boolean);
  const k = fatorDaResolucao(config);
  partes.push(fmts.map(f => (f.largura ? `${f.proporcao} (${f.largura * k}×${f.altura * k})`
    : k > 1 ? `proporção original (menor lado ${1080 * k})` : 'proporção original')).join(' + '));
  if (fmts.some(f => f.largura)) partes.push({ cortar: 'cortando as bordas', barras: 'com barras pretas', desfoque: 'com fundo desfocado' }[config.enquadramento]);
  partes.push(`qualidade ${config.qualidade === 'media' ? 'média' : config.qualidade}`);
  if (config.silencios && config.silencios !== 'desligado') partes.push(`vídeos sem as pausas (${config.silencios})`);
  if (config.capa?.ativa) partes.push(`+ capa 9:16${config.capa.titulo ? ` com "${config.capa.titulo}"` : ''}`);
  if (config.logo?.ativa) partes.push('com o seu logo');
  if (config.modo === 'avancado') {
    const a = config.ajustes || {};
    const sinal = v => (v > 0 ? `+${v}` : `${v}`);
    const ajustes = [
      a.brilho && `brilho ${sinal(a.brilho)}%`, a.contraste && `contraste ${sinal(a.contraste)}%`,
      a.saturacao && `saturação ${sinal(a.saturacao)}%`, a.nitidez && `nitidez ${a.nitidez}%`,
    ].filter(Boolean);
    if (config.realce) partes.push(`realce de qualidade (upscale${k > 1 ? ` em ${RESOLUCOES.find(r => r.fator === k).label}` : ''})`);
    if (config.ia && config.ia !== 'desligado') partes.push(`fotos melhoradas com ${MODOS_IA.find(m => m.value === config.ia)?.label || 'IA'}`);
    if (ajustes.length) partes.push(ajustes.join(', '));
    const t = config.trecho || {};
    if ((Number(t.inicio) || 0) > 0 || (t.fim != null && t.fim !== '')) partes.push(`vídeo de ${Number(t.inicio) || 0}s até ${t.fim == null || t.fim === '' ? 'o fim' : `${t.fim}s`}`);
    if (config.semAudio) partes.push('vídeo sem áudio');
    partes.push(`foto em ${config.formatoFoto.toUpperCase()}`);
  }
  return partes.filter(Boolean).join(' · ');
}

/** Filtro CSS que imita os ajustes na pré-visualização. */
export function filtroCss(config) {
  if (config.modo !== 'avancado') return 'none';
  const a = config.ajustes || {};
  if (!a.brilho && !a.contraste && !a.saturacao) return 'none';
  return `brightness(${1 + (a.brilho || 0) / 100}) contrast(${1 + (a.contraste || 0) / 100}) saturate(${1 + (a.saturacao || 0) / 100})`;
}

/**
 * Seleção com Shift: marca (ou desmarca) tudo entre a última caixa clicada e a
 * atual, na ordem da lista. Devolve o novo Set.
 */
export function selecionarIntervalo(selecao, ordem, ancora, alvo, marcar) {
  const novo = new Set(selecao);
  const a = ordem.indexOf(ancora);
  const b = ordem.indexOf(alvo);
  if (a === -1 || b === -1) {
    if (marcar) novo.add(alvo); else novo.delete(alvo);
    return novo;
  }
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    if (marcar) novo.add(ordem[i]); else novo.delete(ordem[i]);
  }
  return novo;
}

/** "salva por mais ~17 h" */
export function validadeRestante(expiraEm, agora = Date.now()) {
  const ms = new Date(expiraEm).getTime() - agora;
  if (!(ms > 0)) return 'expirando';
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `salva por mais ~${h} h` : `salva por mais ~${Math.max(1, Math.round(ms / 60_000))} min`;
}
