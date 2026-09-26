import { z } from 'zod';
import { analyzeCaption } from './caption.js';
import { INSIGHT_RANGES, JOB_STATUSES, POST_STATUSES, POST_TYPES } from './domain.js';
import { CAROUSEL_MAX_ITEMS, MAX_INTERVAL_MINUTES, MAX_SCHEDULE_AHEAD_DAYS, POST_TYPE_INFO } from './limits.js';

/* Schemas de entrada da API. O backend valida com eles; o frontend usa os
   mesmos para validar formulário e inferir tipos das requisições. */

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Identificador inválido');

export const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido').max(254);

export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa de pelo menos 10 caracteres')
  .max(200, 'Senha longa demais');

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/* ── Conteúdo ─────────────────────────────────────────────────────────── */

export const coverSchema = z
  .object({
    mediaId: objectIdSchema.optional(),
    thumbOffsetMs: z.number().int().min(0).max(15 * 60 * 1000).optional(),
  })
  .refine((c) => !(c.mediaId && c.thumbOffsetMs !== undefined), {
    message: 'Use uma imagem de capa OU um quadro do vídeo, não os dois.',
  });

export const postContentSchema = z
  .object({
    type: z.enum(POST_TYPES),
    caption: z.string().max(10_000).default(''),
    mediaIds: z.array(objectIdSchema).min(1, 'Adicione ao menos uma mídia').max(CAROUSEL_MAX_ITEMS),
    cover: coverSchema.optional(),
    shareToFeed: z.boolean().default(true),
  })
  .superRefine((content, ctx) => {
    const info = POST_TYPE_INFO[content.type];
    if (content.mediaIds.length < info.minItems || content.mediaIds.length > info.maxItems) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaIds'],
        message:
          info.minItems === info.maxItems
            ? `${info.label} aceita exatamente ${info.minItems} mídia.`
            : `${info.label} aceita de ${info.minItems} a ${info.maxItems} mídias.`,
      });
    }
    if (new Set(content.mediaIds).size !== content.mediaIds.length) {
      ctx.addIssue({ code: 'custom', path: ['mediaIds'], message: 'A mesma mídia aparece duas vezes.' });
    }
    if (content.cover && !info.supportsCover) {
      ctx.addIssue({ code: 'custom', path: ['cover'], message: `${info.label} não aceita capa pela API oficial.` });
    }
    if (content.caption && info.supportsCaption) {
      for (const problem of analyzeCaption(content.caption).problems) {
        ctx.addIssue({ code: 'custom', path: ['caption'], message: problem });
      }
    }
  });
export type PostContentInput = z.infer<typeof postContentSchema>;

const accountIdsSchema = z
  .array(objectIdSchema)
  .min(1, 'Selecione ao menos uma conta')
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Conta repetida na seleção');

const futureDateSchema = z.coerce.date().refine(
  (d) => d.getTime() <= Date.now() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000,
  `Agende no máximo ${MAX_SCHEDULE_AHEAD_DAYS} dias à frente`,
);

export const scheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('now') }),
  z.object({ mode: z.literal('scheduled'), at: futureDateSchema }),
  z.object({ mode: z.literal('draft') }),
]);
export type ScheduleInputDto = z.infer<typeof scheduleSchema>;

const minutesSchema = z.number().int().min(0).max(MAX_INTERVAL_MINUTES);

export const createPostSchema = z.object({
  content: postContentSchema,
  accountIds: accountIdsSchema,
  schedule: scheduleSchema,
  /** Minutos entre uma conta e a próxima para o mesmo post. */
  accountStaggerMinutes: minutesSchema.default(0),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome à fila').max(120),
  accountIds: accountIdsSchema,
  items: z.array(postContentSchema).min(1, 'Adicione ao menos um conteúdo').max(200),
  startAt: z.union([z.literal('now'), futureDateSchema]),
  /** Minutos entre um conteúdo e o próximo na mesma conta. */
  intervalMinutes: minutesSchema,
  /** Minutos entre uma conta e a próxima para o mesmo conteúdo. */
  accountStaggerMinutes: minutesSchema.default(0),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const accountSettingsSchema = z.object({
  paused: z.boolean().optional(),
  minIntervalSeconds: z.number().int().min(0).max(24 * 3600).optional(),
});
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;

/* ── Consultas ────────────────────────────────────────────────────────── */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listPostsQuerySchema = paginationSchema.extend({
  status: z.enum(POST_STATUSES).optional(),
  accountId: objectIdSchema.optional(),
  campaignId: objectIdSchema.optional(),
  type: z.enum(POST_TYPES).optional(),
});
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;

export const listJobsQuerySchema = paginationSchema.extend({
  status: z
    .union([z.enum(JOB_STATUSES), z.string().transform((s) => s.split(','))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(JOB_STATUSES)).optional()),
  accountId: objectIdSchema.optional(),
  postId: objectIdSchema.optional(),
  campaignId: objectIdSchema.optional(),
  sort: z.enum(['runAt', '-runAt', '-updatedAt']).default('runAt'),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const insightRangeQuerySchema = z.object({
  range: z.enum(INSIGHT_RANGES).default('30d'),
});

export const markNotificationsSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(objectIdSchema).min(1).max(200) }),
]);
