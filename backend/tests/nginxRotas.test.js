/**
 * Toda rota do Express precisa estar roteada no nginx.
 *
 * ── O que aconteceu
 *
 * `/campaigns` e `/ai` existiam no Express e não constavam em nenhum
 * `location` do nginx. Requisições para elas caíam no bloco final — o do
 * SPA, que serve arquivo estático — e o nginx respondia **405 Not Allowed**
 * a qualquer POST, porque não se faz POST num arquivo.
 *
 * O sintoma não parecia de roteamento: a tela de campanhas abria normal
 * (GET recebia o index.html de volta e o React assumia), e só na hora de
 * criar é que vinha um 405 sem explicação nenhuma, vindo do nginx e não do
 * backend. A IA de legendas estava quebrada do mesmo jeito, em silêncio.
 *
 * ── Por que um teste, e não só a correção
 *
 * A falha é de OMISSÃO: quem adiciona uma rota nova no Express não tem como
 * ser lembrado de editar um arquivo do outro projeto. O erro só aparece em
 * produção, porque em desenvolvimento o Vite fala direto com o backend e não
 * há nginx nenhum no caminho. Este teste é o lembrete que faltava.
 */

const fs = require('fs');
const path = require('path');

const APP    = path.join(__dirname, '..', 'src', 'app.js');
const NGINX  = path.join(__dirname, '..', '..', 'frontend', 'nginx.conf');

/** Prefixos de primeiro nível que o Express atende. */
function rotasDoExpress() {
  const src = fs.readFileSync(APP, 'utf8');
  const achadas = new Set();
  for (const m of src.matchAll(/app\.use\(\s*['"]\/([^'"/]+)/g)) achadas.add(m[1]);
  return [...achadas].sort();
}

/** Prefixos que algum `location` do nginx manda para o backend. */
function rotasDoNginx() {
  const conf = fs.readFileSync(NGINX, 'utf8');
  const achadas = new Set();

  // location ~* ^/(a|b|c)(/|$)
  for (const m of conf.matchAll(/location\s+~\*\s+\^\/\(([^)]+)\)/g)) {
    for (const nome of m[1].split('|')) achadas.add(nome.trim());
  }
  // location = /events  e  location /events
  for (const m of conf.matchAll(/location\s+=?\s*\/([\w-]+)/g)) achadas.add(m[1]);

  return achadas;
}

describe('roteamento do nginx', () => {
  test('toda rota do Express chega ao backend em produção', () => {
    const nginx = rotasDoNginx();
    const faltando = rotasDoExpress().filter(r => !nginx.has(r));

    // Mensagem que diz o que fazer, não só o que falhou: quem quebrar este
    // teste provavelmente acabou de criar a rota e não sabe deste arquivo.
    expect(faltando).toEqual([]);
  });

  test('o SPA não engole as rotas de API compartilhadas', () => {
    // `campaigns` é os dois: página do SPA (/campaigns/nova) e API
    // (POST /campaigns/preview). Precisa estar no bloco que separa os dois
    // casos pelo $spa_nav — no bloco das exclusivas do Express, um F5 em
    // /campaigns/nova devolveria JSON em vez do app.
    const conf = fs.readFileSync(NGINX, 'utf8');
    const compartilhado = conf.match(/location[^\n]*\n(?:[^}]*?\$spa_nav[^}]*?)\}/s);

    expect(compartilhado).not.toBeNull();
    expect(compartilhado[0]).toMatch(/campaigns/);
  });
});
