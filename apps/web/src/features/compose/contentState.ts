import {
  POST_TYPE_INFO,
  analyzeCaption,
  postContentSchema,
  type MediaDTO,
  type PostContentInput,
  type PostType,
} from '@nexora/shared';

/**
 * Estado de UM conteúdo em edição (tipo, mídias, legenda, capa). Regras de
 * negócio do editor moram aqui, em funções puras — os componentes só chamam.
 */
export type CoverMode = 'auto' | 'frame' | 'image';

export interface ContentDraft {
  type: PostType;
  media: MediaDTO[];
  caption: string;
  coverMode: CoverMode;
  coverImage: MediaDTO | null;
  coverFrameSeconds: number;
  shareToFeed: boolean;
}

export const emptyContent = (type: PostType = 'IMAGE'): ContentDraft => ({
  type,
  media: [],
  caption: '',
  coverMode: 'auto',
  coverImage: null,
  coverFrameSeconds: 0,
  shareToFeed: true,
});

export type ContentAction =
  | { type: 'setType'; postType: PostType }
  | { type: 'addMedia'; media: MediaDTO[] }
  | { type: 'removeMedia'; id: string }
  | { type: 'moveMedia'; id: string; delta: -1 | 1 }
  | { type: 'setCaption'; caption: string }
  | { type: 'setCoverMode'; mode: CoverMode }
  | { type: 'setCoverImage'; media: MediaDTO | null }
  | { type: 'setCoverFrame'; seconds: number }
  | { type: 'setShareToFeed'; value: boolean }
  | { type: 'reset'; draft?: ContentDraft };

/** Mantém só as mídias que o tipo aceita, até o máximo permitido. */
export function fitMediaToType(media: MediaDTO[], type: PostType): MediaDTO[] {
  const info = POST_TYPE_INFO[type];
  return media.filter((m) => info.acceptsKinds.includes(m.kind)).slice(0, info.maxItems);
}

export function contentReducer(state: ContentDraft, action: ContentAction): ContentDraft {
  switch (action.type) {
    case 'setType': {
      const media = fitMediaToType(state.media, action.postType);
      return { ...state, type: action.postType, media, ...(POST_TYPE_INFO[action.postType].supportsCover ? {} : { coverMode: 'auto', coverImage: null }) };
    }
    case 'addMedia': {
      const info = POST_TYPE_INFO[state.type];
      const existing = new Set(state.media.map((m) => m.id));
      const incoming = action.media.filter((m) => !existing.has(m.id) && info.acceptsKinds.includes(m.kind));
      // Tipo de item único: a nova mídia substitui a anterior.
      const media = info.maxItems === 1 ? incoming.slice(-1).concat(incoming.length ? [] : state.media) : [...state.media, ...incoming].slice(0, info.maxItems);
      return { ...state, media };
    }
    case 'removeMedia':
      return { ...state, media: state.media.filter((m) => m.id !== action.id) };
    case 'moveMedia': {
      const i = state.media.findIndex((m) => m.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= state.media.length) return state;
      const media = [...state.media];
      [media[i], media[j]] = [media[j]!, media[i]!];
      return { ...state, media };
    }
    case 'setCaption':
      return { ...state, caption: action.caption };
    case 'setCoverMode':
      return { ...state, coverMode: action.mode, ...(action.mode !== 'image' ? { coverImage: null } : {}) };
    case 'setCoverImage':
      return { ...state, coverImage: action.media, coverMode: action.media ? 'image' : 'auto' };
    case 'setCoverFrame':
      return { ...state, coverFrameSeconds: Math.max(0, action.seconds) };
    case 'setShareToFeed':
      return { ...state, shareToFeed: action.value };
    case 'reset':
      return action.draft ?? emptyContent(state.type);
  }
}

export function toContentInput(d: ContentDraft): PostContentInput {
  const info = POST_TYPE_INFO[d.type];
  return {
    type: d.type,
    caption: info.supportsCaption ? d.caption : '',
    mediaIds: d.media.map((m) => m.id),
    shareToFeed: d.shareToFeed,
    ...(info.supportsCover && d.coverMode === 'image' && d.coverImage ? { cover: { mediaId: d.coverImage.id } } : {}),
    ...(info.supportsCover && d.coverMode === 'frame' ? { cover: { thumbOffsetMs: Math.round(d.coverFrameSeconds * 1000) } } : {}),
  };
}

/** Problemas que impedem o envio, em linguagem de usuário. Vazio = pode enviar. */
export function contentProblems(d: ContentDraft): string[] {
  const problems: string[] = [];
  const info = POST_TYPE_INFO[d.type];
  if (d.media.length < info.minItems) {
    problems.push(info.minItems === 1 ? 'Adicione a mídia da publicação.' : `Adicione pelo menos ${info.minItems} mídias ao carrossel.`);
  }
  if (info.supportsCover && d.coverMode === 'image' && !d.coverImage) problems.push('Escolha a imagem de capa ou use a capa automática.');
  const video = d.media.find((m) => m.kind === 'video');
  if (d.coverMode === 'frame' && video?.durationSeconds && d.coverFrameSeconds > video.durationSeconds) {
    problems.push('O quadro da capa está depois do fim do vídeo.');
  }
  if (info.supportsCaption) problems.push(...analyzeCaption(d.caption).problems);
  if (!problems.length) {
    const parsed = postContentSchema.safeParse(toContentInput(d));
    if (!parsed.success) problems.push(parsed.error.issues[0]!.message);
  }
  return problems;
}
