import type { MetadataCategory } from './settings';

export const METADATA_CATEGORY_LABELS: Record<MetadataCategory | 'technical', { label: string; hint: string }> = {
  gps: { label: 'GPS e localização', hint: 'Coordenadas, endereço, telemetria com posição.' },
  dates: { label: 'Datas e horários', hint: 'Data de captura, criação, modificação e fuso.' },
  device: { label: 'Dispositivo', hint: 'Fabricante, modelo, lente, número de série.' },
  descriptive: { label: 'Comentários e descrições', hint: 'Título, descrição, comentário, autor, direitos.' },
  software: { label: 'Software e encoder', hint: 'Programa de edição, versão do sistema, encoder.' },
  custom: { label: 'Metadados personalizados', hint: 'Chaves proprietárias, XMP, IPTC, miniaturas embutidas.' },
  container: { label: 'Tags do contêiner', hint: 'Tags técnicas extras do arquivo e capítulos.' },
  streams: { label: 'Tags dos fluxos', hint: 'Handler, idioma, timecode, fluxos de dados e anexos.' },
  embedded: {
    label: 'Dados no bitstream (SEI)',
    hint: 'Parâmetros do encoder gravados dentro do vídeo H.264/HEVC. Remoção sem recodificar.',
  },
  technical: { label: 'Estrutura técnica', hint: 'Campos exigidos pelo formato; não identificam a origem.' },
};

export const JOB_STATUS_LABELS = {
  queued: 'Na fila',
  running: 'Processando',
  completed: 'Concluída',
  failed: 'Falhou',
  canceled: 'Cancelada',
} as const;

export const PHASE_LABELS = {
  aguardando: 'Aguardando',
  preparando: 'Preparando',
  processando: 'Processando',
  validando: 'Validando',
  finalizando: 'Finalizando',
} as const;

export const STRATEGY_LABELS = {
  'stream-copy': 'Cópia de fluxos (sem recodificar)',
  're-encode': 'Recodificação',
  'image-lossless': 'Limpeza sem perdas',
  'image-encode': 'Recodificação de imagem',
} as const;
