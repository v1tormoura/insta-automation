import type { ProcessingSettingsInput } from './settings';

/**
 * Perfis de exportação embutidos. Cada perfil é um "patch" sobre as
 * configurações atuais: só os campos listados são substituídos. Cada perfil
 * selecionado gera uma saída por arquivo.
 */
export interface BuiltinProfile {
  id: string;
  name: string;
  description: string;
  /** Campos aplicados por cima das configurações atuais. */
  patch: DeepPartial<ProcessingSettingsInput>;
}

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export const EXPORT_PROFILES: BuiltinProfile[] = [
  {
    id: 'original-limpo',
    name: 'Original limpo',
    description: 'Mesmo formato e resolução; copia os fluxos quando possível.',
    patch: { output: { format: 'original' }, video: { codec: 'auto' }, audio: { codec: 'auto' } },
  },
  {
    id: 'vertical-9x16',
    name: 'Vertical 9:16',
    description: '1080×1920, H.264/AAC, 30 fps — Reels, Shorts, Stories.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'h264', fps: '30', rateControl: 'quality', quality: 72 },
      audio: { codec: 'aac', bitrateKbps: 160 },
      geometry: { aspect: '9:16', resolution: '1080', fit: 'crop' },
    },
  },
  {
    id: 'feed-4x5',
    name: 'Feed 4:5',
    description: '1080×1350, H.264/AAC.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'h264', rateControl: 'quality', quality: 72 },
      audio: { codec: 'aac', bitrateKbps: 160 },
      geometry: { aspect: '4:5', resolution: '1080', fit: 'crop' },
    },
  },
  {
    id: 'quadrado-1x1',
    name: 'Quadrado 1:1',
    description: '1080×1080, H.264/AAC.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'h264', rateControl: 'quality', quality: 72 },
      audio: { codec: 'aac', bitrateKbps: 160 },
      geometry: { aspect: '1:1', resolution: '1080', fit: 'crop' },
    },
  },
  {
    id: 'paisagem-16x9',
    name: 'Paisagem 16:9',
    description: '1920×1080, H.264/AAC.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'h264', rateControl: 'quality', quality: 72 },
      audio: { codec: 'aac', bitrateKbps: 160 },
      geometry: { aspect: '16:9', resolution: '1080', fit: 'pad' },
    },
  },
  {
    id: 'web-720p',
    name: 'Web leve 720p',
    description: 'Proporção original, lado menor 720 px, arquivo compacto.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'h264', rateControl: 'quality', quality: 58, speed: 'balanced' },
      audio: { codec: 'aac', bitrateKbps: 128 },
      geometry: { aspect: 'original', resolution: '720' },
    },
  },
  {
    id: 'webm-vp9',
    name: 'WebM VP9',
    description: 'VP9 + Opus para uso na web.',
    patch: {
      output: { format: 'webm' },
      video: { codec: 'vp9', rateControl: 'quality', quality: 66 },
      audio: { codec: 'opus', bitrateKbps: 128 },
    },
  },
  {
    id: 'arquivo-hevc',
    name: 'Arquivo HEVC',
    description: 'H.265 em alta qualidade para arquivamento.',
    patch: {
      output: { format: 'mp4' },
      video: { codec: 'hevc', rateControl: 'quality', quality: 80, speed: 'quality' },
      audio: { codec: 'aac', bitrateKbps: 192 },
    },
  },
];

/**
 * Perfis editoriais predefinidos: pontos de partida explícitos para o modo
 * editorial. Ao aplicar, os campos aparecem preenchidos na interface e podem
 * ser revistos antes de processar.
 */
export const EDITORIAL_PRESETS: BuiltinProfile[] = [
  {
    id: 'ed-vertical-desfocado',
    name: 'Vertical com fundo desfocado',
    description: 'Mantém o quadro inteiro em 9:16 sobre uma cópia desfocada.',
    patch: {
      mode: 'editorial',
      output: { format: 'mp4' },
      video: { codec: 'h264', fps: '30' },
      geometry: { aspect: '9:16', resolution: '1080', fit: 'blur' },
    },
  },
  {
    id: 'ed-teaser-15',
    name: 'Teaser de 15 s',
    description: 'Primeiros 15 segundos com entrada e saída suaves.',
    patch: {
      mode: 'editorial',
      output: { format: 'mp4' },
      video: { codec: 'h264' },
      trim: { start: 0, end: 15 },
      fade: { in: 0.5, out: 0.8 },
    },
  },
  {
    id: 'ed-abertura-titulo',
    name: 'Abertura com título',
    description: 'Cartela de título de 2,5 s antes do vídeo.',
    patch: {
      mode: 'editorial',
      output: { format: 'mp4' },
      video: { codec: 'h264' },
      editorial: {
        intro: { type: 'card', text: 'Título', duration: 2.5, background: '#0A1022', color: '#FFFFFF', size: 7 },
      },
      fade: { in: 0.3, out: 0.5 },
    },
  },
  {
    id: 'ed-legenda-inferior',
    name: 'Texto inferior',
    description: 'Faixa de texto na base durante todo o vídeo.',
    patch: {
      mode: 'editorial',
      output: { format: 'mp4' },
      video: { codec: 'h264' },
      editorial: {
        texts: [
          {
            text: 'Seu texto aqui',
            start: 0,
            end: null,
            position: 'bottom',
            size: 4.5,
            color: '#FFFFFF',
            opacity: 1,
            box: true,
            boxColor: '#000000',
            boxOpacity: 0.45,
          },
        ],
      },
    },
  },
];

export const METADATA_PRESETS = {
  total: {
    gps: true,
    dates: true,
    device: true,
    descriptive: true,
    software: true,
    custom: true,
    container: true,
    streams: true,
    embedded: true,
  },
  privacidade: {
    gps: true,
    dates: true,
    device: true,
    descriptive: true,
    software: true,
    custom: true,
    container: true,
    streams: true,
    embedded: false,
  },
  localizacao: {
    gps: true,
    dates: false,
    device: false,
    descriptive: false,
    software: false,
    custom: false,
    container: false,
    streams: false,
    embedded: false,
  },
  nenhuma: {
    gps: false,
    dates: false,
    device: false,
    descriptive: false,
    software: false,
    custom: false,
    container: false,
    streams: false,
    embedded: false,
  },
} as const;
