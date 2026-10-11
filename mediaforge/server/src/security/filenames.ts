import { randomBytes } from 'node:crypto';

/** Identificador aleatório seguro para URLs e nomes de arquivo (base64url). */
export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

/** Nomes de dispositivo reservados no Windows (inclusive com dígitos sobrescritos ¹²³). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
/** Controles de direção de texto usados para disfarçar extensões ("foto\u202Egpj.exe"). */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Substitutos UTF-16 isolados (nome cortado no meio de um emoji etc.). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Corta sem quebrar pares substitutos, respeitando um máximo de unidades UTF-16
 * (limite do Windows) e, opcionalmente, de bytes UTF-8 (limite de 255 bytes por
 * nome no Linux).
 */
function cutText(text: string, maxUnits: number, maxBytes = Infinity): string {
  let units = 0;
  let bytes = 0;
  let out = '';
  for (const cp of text) {
    const b = Buffer.byteLength(cp, 'utf8');
    if (units + cp.length > maxUnits || bytes + b > maxBytes) break;
    units += cp.length;
    bytes += b;
    out += cp;
  }
  return out;
}

/**
 * Normaliza o nome original para exibição e para os nomes de saída.
 * Remove diretórios, caracteres de controle, separadores e sequências perigosas;
 * nunca é usado como caminho de armazenamento (os arquivos são guardados pelo id).
 */
export function sanitizeDisplayName(input: string, fallback = 'arquivo'): string {
  let name = String(input ?? '')
    .replace(LONE_SURROGATE, '')
    .normalize('NFC')
    .replace(/^.*[\\/]/, '') // só o último componente
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(BIDI_CONTROLS, '')
    .trim();
  const tidy = (v: string) => v.replace(/^\.+/, '').replace(/[. ]+$/, '');
  name = tidy(name);
  if (name.length > 180 || Buffer.byteLength(name, 'utf8') > 240) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = tidy(cutText(name.slice(0, name.length - ext.length), 180 - ext.length, 240 - Buffer.byteLength(ext))) + ext;
  }
  // No Windows, "NUL.tar.gz" também é reservado: vale o trecho antes do PRIMEIRO ponto.
  const head = name.split('.')[0]!.trim();
  if (!name || WINDOWS_RESERVED.test(head)) return fallback;
  return name;
}

/** Base (sem extensão) adequada para compor nomes de saída. */
export function outputStem(displayName: string): string {
  const stem = sanitizeDisplayName(displayName).replace(/\.[^.]*$/, '');
  const compact = stem
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .replace(/_+/g, '_');
  // 80 unidades e 120 bytes: sobra espaço para o sufixo do perfil e a extensão.
  const cut = cutText(compact, 80, 120).replace(/[. ]+$/, '');
  return cut || 'midia';
}

/** Fragmento seguro para nomes de arquivo a partir de um rótulo livre. */
export function slug(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'saida'
  );
}

/** Cabeçalho Content-Disposition com nome ASCII de reserva e versão UTF-8 (RFC 6266/5987). */
export function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const safe = sanitizeDisplayName(filename).replace(LONE_SURROGATE, '\uFFFD');
  const ascii = safe
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
