/**
 * Tema, fundo e idioma — aplicados no documento.
 *
 * ── Por que o localStorage, se o servidor já guarda
 *
 * O servidor é a verdade; o localStorage é a velocidade. A preferência é
 * aplicada ANTES do primeiro render, lida do disco do navegador. Esperando a
 * resposta de `/conta`, o app pinta escuro, depois claro — o "flash" do tema
 * errado, que é a coisa mais visível que uma tela de preferências pode fazer
 * de errado.
 *
 * A resposta do servidor chega em seguida e corrige, se divergir. Isso também
 * é o que faz a preferência atravessar aparelhos: o localStorage de um celular
 * não sabe nada do que foi escolhido no computador.
 *
 * ── Por que no `<html>` e não em cada raiz
 *
 * Os tokens do tema moram em `[data-mf]`, e esse atributo está em oito raízes
 * de página diferentes (o app, o login, o callback, os termos…). Marcar o
 * `<html>` e deixar o CSS descer por descendência é uma linha; fazer as oito
 * lerem um contexto do React seriam oito lugares para esquecer um.
 */

const CHAVE = 'mf-preferencias';

const PADRAO = { tema: 'escuro', idioma: 'pt', fundoAnimado: true };

/** O que está gravado neste navegador. Nunca lança: aba privada bloqueia o acesso. */
export function lidas() {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return { ...PADRAO };
    const v = JSON.parse(cru);
    return {
      tema: v?.tema === 'claro' ? 'claro' : 'escuro',
      idioma: ['pt', 'en', 'es'].includes(v?.idioma) ? v.idioma : 'pt',
      fundoAnimado: v?.fundoAnimado !== false,
    };
  } catch {
    return { ...PADRAO };
  }
}

/**
 * Escreve os atributos no `<html>`.
 *
 * `data-tema` só aparece no claro. O escuro é o padrão do CSS, e um
 * `data-tema="escuro"` no documento sugeriria que existe um bloco de tokens
 * para ele — não existe, e alguém iria procurar.
 */
export function aplicar(p = lidas()) {
  const raiz = document.documentElement;

  if (p.tema === 'claro') raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');

  /* Idem: o atributo marca o desvio do padrão, não o padrão. */
  if (p.fundoAnimado === false) raiz.setAttribute('data-fundo', 'estatico');
  else raiz.removeAttribute('data-fundo');

  raiz.setAttribute('lang', p.idioma === 'en' ? 'en' : p.idioma === 'es' ? 'es' : 'pt-BR');
  return p;
}

/** Grava neste navegador e aplica. */
export function salvar(parcial) {
  const p = { ...lidas(), ...parcial };
  try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* aba privada */ }
  return aplicar(p);
}

/** Aplica o que o servidor devolveu, e alinha o navegador com ele. */
export function sincronizar(doServidor) {
  if (!doServidor) return lidas();
  return salvar({
    tema: doServidor.tema,
    idioma: doServidor.idioma,
    fundoAnimado: doServidor.fundoAnimado,
  });
}

export default { lidas, aplicar, salvar, sincronizar };
