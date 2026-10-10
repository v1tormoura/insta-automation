import { randomBytes } from 'node:crypto';

/** Identificador aleatório seguro para URLs e nomes de arquivo (base64url). */
export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Normaliza o nome original para exibição e para os nomes de saída.
 * Remove diretórios, caracteres de controle, separadores e sequências perigosas;
 * nunca é usado como caminho de armazenamento (os arquivos são guardados pelo id).
 */
export function sanitizeDisplayName(input: string, fallback = 'arquivo'): string {
  let name = String(input ?? '')
    .normalize('NFC')
    .replace(/^.*[\\/]/, '') // só o último componente
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\u202E|\u202D|\u200E|\u200F/g, '') // sobrescritas de direção (spoofing de extensão)
    .trim();
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (name.length > 180) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 180 - ext.length) + ext;
  }
  const stem = name.replace(/\.[^.]*$/, '');
  if (!name || WINDOWS_RESERVED.test(stem)) return fallback;
  return name;
}

/** Base (sem extensão) adequada para compor nomes de saída. */
export function outputStem(displayName: string): string {
  const stem = sanitizeDisplayName(displayName).replace(/\.[^.]*$/, '');
  const compact = stem
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .replace(/_+/g, '_')
    .slice(0, 80);
  return compact || 'midia';
}

/** Fragmento seguro para nomes de arquivo a partir de um rótulo livre. */
export function slug(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'saida'
  );
}

/** Cabeçalho Content-Disposition com nome ASCII de reserva e versão UTF-8 (RFC 6266/5987). */
export function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const safe = sanitizeDisplayName(filename);
  const ascii = safe
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
