import { redactText } from '../../lib/redact.js';

/**
 * Classificação dos erros da Graph API.
 *
 * A decisão que importa para a fila é binária — tentar de novo ou não — mais
 * o "quando". O resto (categoria e mensagem em português) é para o usuário
 * entender o que aconteceu sem abrir log.
 *
 * Fontes: Graph API "Handling Errors", Instagram Platform "Error codes" e
 * Content Publishing "Troubleshooting" (subcódigos 2207xxx).
 */

export type MetaErrorCategory =
  | 'auth' // token inválido/expirado/revogado → conta precisa reconectar
  | 'permission' // permissão não concedida
  | 'rate_limit' // limite de chamadas da API
  | 'publish_limit' // limite de publicações em 24h
  | 'not_ready' // container ainda processando
  | 'media' // mídia rejeitada (formato, proporção, tamanho, download)
  | 'account' // conta restrita/bloqueada pela Meta
  | 'invalid_request'
  | 'not_found'
  | 'transient' // falha temporária / rede / 5xx
  | 'unknown';

export interface MetaErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

interface Classification {
  category: MetaErrorCategory;
  retryable: boolean;
  /** Espera sugerida antes da próxima tentativa. */
  retryAfterMs?: number;
  message: string;
}

const MIN = 60_000;

/** Subcódigos do Content Publishing com tratamento e texto próprios. */
const SUBCODES: Record<number, Classification> = {
  2207001: { category: 'transient', retryable: true, retryAfterMs: 2 * MIN, message: 'O Instagram teve um erro interno ao processar a mídia.' },
  2207003: { category: 'media', retryable: true, retryAfterMs: 2 * MIN, message: 'O Instagram demorou demais para baixar a mídia.' },
  2207004: { category: 'media', retryable: false, message: 'Imagem grande demais (máximo 8 MB).' },
  2207005: { category: 'media', retryable: false, message: 'Formato de imagem não suportado (use JPEG).' },
  2207006: { category: 'not_found', retryable: false, message: 'A mídia não foi encontrada ou a conta não tem permissão sobre ela.' },
  2207008: { category: 'media', retryable: true, retryAfterMs: MIN, message: 'O container de mídia expirou; um novo será criado.' },
  2207009: { category: 'media', retryable: false, message: 'Proporção da imagem fora do permitido (entre 4:5 e 1.91:1).' },
  2207010: { category: 'media', retryable: false, message: 'Legenda longa demais, ou hashtags/menções acima do limite.' },
  2207020: { category: 'media', retryable: true, retryAfterMs: MIN, message: 'A mídia expirou antes da publicação; um novo container será criado.' },
  2207023: { category: 'media', retryable: false, message: 'Tipo de mídia desconhecido para o Instagram.' },
  2207026: { category: 'media', retryable: false, message: 'Formato de vídeo não suportado (use MP4/MOV com H.264 e AAC).' },
  2207027: { category: 'not_ready', retryable: true, retryAfterMs: 30_000, message: 'A mídia ainda está sendo processada pelo Instagram.' },
  2207028: { category: 'media', retryable: false, message: 'O carrossel não passou na validação do Instagram (verifique os itens).' },
  2207032: { category: 'transient', retryable: true, retryAfterMs: 2 * MIN, message: 'O Instagram não conseguiu criar a mídia. Nova tentativa agendada.' },
  2207042: { category: 'publish_limit', retryable: true, retryAfterMs: 60 * MIN, message: 'A conta atingiu o limite de publicações via API nas últimas 24h.' },
  2207050: { category: 'account', retryable: false, message: 'A conta do Instagram está restrita ou inativa. Verifique a conta no app.' },
  2207051: { category: 'account', retryable: false, message: 'O Instagram bloqueou a ação nesta conta (restrição de atividade).' },
  2207052: { category: 'media', retryable: true, retryAfterMs: 5 * MIN, message: 'O Instagram não conseguiu baixar a mídia pela URL pública.' },
  2207053: { category: 'transient', retryable: true, retryAfterMs: 2 * MIN, message: 'Erro desconhecido no upload. Nova tentativa agendada.' },
  2207057: { category: 'media', retryable: false, message: 'O ponto escolhido para a capa (thumb_offset) é inválido para este vídeo.' },
};

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80006]);
const AUTH_CODES = new Set([102, 190]);

export function classifyMetaError(status: number, payload: MetaErrorPayload | undefined, retryAfterMs?: number): Classification {
  const code = payload?.code;
  const subcode = payload?.error_subcode;
  const userMsg = payload?.error_user_msg;

  if (subcode && SUBCODES[subcode]) {
    const known = SUBCODES[subcode]!;
    return { ...known, message: userMsg ? `${known.message} (${userMsg})` : known.message };
  }
  if (code !== undefined && AUTH_CODES.has(code)) {
    return { category: 'auth', retryable: false, message: 'O acesso à conta expirou ou foi revogado. Reconecte a conta.' };
  }
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) {
    return { category: 'permission', retryable: false, message: 'Permissão necessária não foi concedida. Reconecte a conta aceitando todas as permissões.' };
  }
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return { category: 'rate_limit', retryable: true, retryAfterMs: retryAfterMs ?? 15 * MIN, message: 'Limite de chamadas da API da Meta atingido. Retomaremos automaticamente.' };
  }
  if (code === 9007) {
    return { category: 'not_ready', retryable: true, retryAfterMs: 30_000, message: 'A mídia ainda está sendo processada pelo Instagram.' };
  }
  if (code === 100 && subcode === 33) {
    return { category: 'not_found', retryable: false, message: 'Objeto não encontrado no Instagram.' };
  }
  if (code === undefined && status !== 429) {
    // Resposta sem o formato de erro da Graph API: veio de proxy, firewall ou
    // balanceador no caminho, não da Meta. É problema de conectividade.
    return {
      category: 'transient',
      retryable: true,
      retryAfterMs: 2 * MIN,
      message: `Resposta inesperada ao falar com a Meta (HTTP ${status}). Verifique se o servidor alcança graph.instagram.com.`,
    };
  }
  if (payload?.is_transient || code === 1 || code === 2 || status >= 500) {
    return { category: 'transient', retryable: true, retryAfterMs: MIN, message: 'Instabilidade temporária na Meta. Nova tentativa agendada.' };
  }
  if (code === 100 || code === 24 || code === 36003 || status === 400) {
    return { category: 'invalid_request', retryable: false, message: userMsg || 'O Instagram recusou a requisição.' };
  }
  return { category: 'unknown', retryable: status >= 500, message: userMsg || 'Erro inesperado na API da Meta.' };
}

export class MetaApiError extends Error {
  readonly category: MetaErrorCategory;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly userMessage: string;
  readonly code?: number;
  readonly subcode?: number;
  readonly fbtraceId?: string;

  constructor(
    readonly status: number,
    payload: MetaErrorPayload | undefined,
    readonly endpoint: string,
    retryAfterMs?: number,
  ) {
    const c = classifyMetaError(status, payload, retryAfterMs);
    super(redactText(`Meta ${status} em ${endpoint}: ${payload?.message ?? 'sem mensagem'} (code=${payload?.code} sub=${payload?.error_subcode})`));
    this.name = 'MetaApiError';
    this.category = c.category;
    this.retryable = c.retryable;
    this.retryAfterMs = c.retryAfterMs;
    this.userMessage = c.message;
    this.code = payload?.code;
    this.subcode = payload?.error_subcode;
    this.fbtraceId = payload?.fbtrace_id;
  }
}

/** Falha de rede/timeout antes de existir resposta da Meta. */
export class MetaNetworkError extends Error {
  readonly category = 'transient' as const;
  readonly retryable = true;
  readonly userMessage = 'Não foi possível falar com a Meta (rede). Nova tentativa agendada.';

  constructor(
    readonly endpoint: string,
    cause: unknown,
  ) {
    super(redactText(`Falha de rede em ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`));
    this.name = 'MetaNetworkError';
  }
}

export type MetaError = MetaApiError | MetaNetworkError;

export function isMetaError(err: unknown): err is MetaError {
  return err instanceof MetaApiError || err instanceof MetaNetworkError;
}
