// Gerencia o sufixo CTA global da legenda (ex: "Link na bio")
// Persistido em localStorage — sem backend necessário.

const STORAGE_KEY = 'cta_suffix_v1';
const DEFAULT_TEXT = '\n\n🔗 Link na bio';

export function getCTASuffix() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, text: DEFAULT_TEXT };
    return JSON.parse(raw);
  } catch {
    return { enabled: false, text: DEFAULT_TEXT };
  }
}

export function setCTASuffix(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function applyCTASuffix(caption, state) {
  const { enabled, text } = state ?? getCTASuffix();
  if (!enabled || !text.trim()) return caption || '';
  return (caption || '') + text;
}
