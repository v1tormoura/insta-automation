import type { AccountStatus, CampaignStatus, JobStatus, PostStatus, PostType } from '@nexora/shared';

export type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'muted' | 'default';

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: Tone; hint: string }> = {
  CONNECTED: { label: 'Conectada', tone: 'success', hint: 'Pronta para publicar.' },
  SYNCING: { label: 'Sincronizando', tone: 'info', hint: 'Atualizando perfil, cota e métricas.' },
  EXPIRED: { label: 'Expirada', tone: 'warning', hint: 'O acesso expirou. Reconecte para voltar a publicar.' },
  ERROR: { label: 'Com problema', tone: 'destructive', hint: 'A Meta recusou uma ação desta conta.' },
  DISCONNECTED: { label: 'Desconectada', tone: 'muted', hint: 'Sem acesso. Conecte de novo para usar.' },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Agendado', tone: 'muted' },
  QUEUED: { label: 'Na fila', tone: 'info' },
  CREATING: { label: 'Enviando mídia', tone: 'info' },
  PROCESSING: { label: 'Processando', tone: 'info' },
  PUBLISHING: { label: 'Publicando', tone: 'info' },
  PUBLISHED: { label: 'Publicado', tone: 'success' },
  FAILED: { label: 'Falhou', tone: 'destructive' },
  CANCELED: { label: 'Cancelado', tone: 'muted' },
};

export const POST_STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'muted' },
  SCHEDULED: { label: 'Agendado', tone: 'default' },
  PUBLISHING: { label: 'Publicando', tone: 'info' },
  PUBLISHED: { label: 'Publicado', tone: 'success' },
  PARTIAL: { label: 'Parcial', tone: 'warning' },
  FAILED: { label: 'Falhou', tone: 'destructive' },
  CANCELED: { label: 'Cancelado', tone: 'muted' },
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Ativa', tone: 'info' },
  PAUSED: { label: 'Pausada', tone: 'warning' },
  COMPLETED: { label: 'Concluída', tone: 'success' },
  PARTIAL: { label: 'Concluída com falhas', tone: 'warning' },
  FAILED: { label: 'Falhou', tone: 'destructive' },
  CANCELED: { label: 'Cancelada', tone: 'muted' },
};

export const POST_TYPE_LABEL: Record<PostType, string> = {
  IMAGE: 'Foto',
  CAROUSEL: 'Carrossel',
  REEL: 'Reel',
  STORY: 'Story',
};

/** Mensagens dos códigos de erro do callback do OAuth (?oauth_error=...). */
export const OAUTH_ERRORS: Record<string, string> = {
  invalid_state: 'O link de autorização é inválido. Comece a conexão de novo pelo botão "Conectar Instagram".',
  expired_state: 'A autorização demorou mais de 10 minutos e expirou. Tente conectar de novo.',
  session_mismatch: 'A autorização voltou numa sessão diferente da que iniciou a conexão. Entre na sua conta e tente de novo.',
  access_denied: 'A autorização foi cancelada no Instagram. Nenhuma conta foi conectada.',
  missing_permissions: 'Faltaram permissões obrigatórias (perfil e publicação de conteúdo). Conecte de novo e aceite todas.',
  plan_limit: 'Seu plano atingiu o limite de contas conectadas. Desconecte uma conta ou faça upgrade.',
  meta_error: 'A Meta não concluiu a autorização. Tente de novo em instantes.',
  in_progress: 'Esta autorização ainda está sendo processada. Atualize a página em alguns segundos.',
  not_configured: 'A integração com o Instagram ainda não foi configurada neste servidor.',
};

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? 'Não foi possível conectar a conta. Tente de novo.';
}
