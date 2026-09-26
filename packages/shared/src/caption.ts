import { CAPTION_MAX_HASHTAGS, CAPTION_MAX_LENGTH, CAPTION_MAX_MENTIONS } from './limits.js';

export interface CaptionAnalysis {
  length: number;
  hashtags: number;
  mentions: number;
  problems: string[];
}

const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_.])@[\p{L}\p{N}_.]+/gu;

/**
 * Conta caracteres como o Instagram conta (code points, não UTF-16), além de
 * hashtags e menções. A mesma função valida no editor e na API.
 */
export function analyzeCaption(caption: string): CaptionAnalysis {
  const length = [...caption].length;
  const hashtags = caption.match(HASHTAG_RE)?.length ?? 0;
  const mentions = caption.match(MENTION_RE)?.length ?? 0;
  const problems: string[] = [];
  if (length > CAPTION_MAX_LENGTH) problems.push(`A legenda passa de ${CAPTION_MAX_LENGTH} caracteres.`);
  if (hashtags > CAPTION_MAX_HASHTAGS) problems.push(`Máximo de ${CAPTION_MAX_HASHTAGS} hashtags por publicação.`);
  if (mentions > CAPTION_MAX_MENTIONS) problems.push(`Máximo de ${CAPTION_MAX_MENTIONS} menções por publicação.`);
  return { length, hashtags, mentions, problems };
}
