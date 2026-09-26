/**
 * Remoção de segredos de qualquer texto que possa chegar a um log, a uma
 * mensagem de erro salva no banco ou a uma resposta HTTP.
 */

const SECRET_PARAMS = ['access_token', 'client_secret', 'code', 'input_token', 'fb_exchange_token', 'refresh_token'];
const PARAM_RE = new RegExp(`([?&](?:${SECRET_PARAMS.join('|')})=)[^&#\\s"']+`, 'gi');
// Formatos conhecidos de token da Meta: IGAA…/IGQ… (Instagram Login) e EAA… (Facebook Login).
const TOKEN_RE = /\b(?:IGAA|IGQV|IGQ|EAA)[A-Za-z0-9_-]{20,}\b/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export function redactText(input: string): string {
  return input.replace(PARAM_RE, '$1[REDACTED]').replace(TOKEN_RE, '[REDACTED_TOKEN]').replace(BEARER_RE, '$1[REDACTED]');
}

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.access_token',
  '*.token',
  '*.client_secret',
  '*.clientSecret',
];
