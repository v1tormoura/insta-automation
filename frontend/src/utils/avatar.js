const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * URL exibível para a foto de perfil de uma conta.
 *
 * O Instagram serve os avatares de um CDN que recusa hotlink: usar a URL
 * direta no `src` devolve 403 e a imagem some sem erro no console. Por isso
 * o endereço externo passa pelo `/image-proxy` do backend, que busca e
 * reentrega. Caminho relativo (avatar que nós mesmos guardamos) só precisa
 * do prefixo da API.
 *
 * @param {string} avatar  o campo `avatar` da conta
 * @returns {string|null}  null quando a conta não tem foto
 */
export function urlDoAvatar(avatar) {
  if (!avatar) return null;
  return avatar.startsWith('http')
    ? `${API}/image-proxy?url=${encodeURIComponent(avatar)}`
    : `${API}${avatar}`;
}

/** Iniciais para o círculo que substitui a foto ausente. */
export function iniciaisDe(username = '') {
  return (username.replace(/^@/, '').slice(0, 2) || '??').toUpperCase();
}
