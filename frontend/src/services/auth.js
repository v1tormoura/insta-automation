const KEY = 'instaflow_token';
const USUARIO = 'instaflow_usuario';

export const getToken    = ()      => localStorage.getItem(KEY);
export const setToken    = (token) => localStorage.setItem(KEY, token);
export const removeToken = ()      => { localStorage.removeItem(KEY); localStorage.removeItem(USUARIO); };
export const isAuthenticated = ()  => !!getToken();

/** Quem está logado: { id, nome, email, papel, avatar }. */
export function getUsuario() {
  try { return JSON.parse(localStorage.getItem(USUARIO) || 'null'); } catch { return null; }
}
export function setUsuario(usuario) {
  try { localStorage.setItem(USUARIO, JSON.stringify(usuario || null)); } catch { /* sem armazenamento */ }
}
export const isAdmin = () => getUsuario()?.papel === 'admin';
