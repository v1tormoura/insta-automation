const KEY = 'instaflow_token';

export const getToken    = ()      => localStorage.getItem(KEY);
export const setToken    = (token) => localStorage.setItem(KEY, token);
export const removeToken = ()      => localStorage.removeItem(KEY);
export const isAuthenticated = ()  => !!getToken();
