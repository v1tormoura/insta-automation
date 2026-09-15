'use strict';

/**
 * O App Meta e o fluxo OAuth de múltiplos apps.
 *
 * ── O que estes testes protegem
 *
 *   segredo em repouso   → o App Secret é gravado CIFRADO (encrypt), nunca em
 *                          texto puro, e o fluxo OAuth o decifra na hora de usar.
 *   segredo na resposta  → a API nunca devolve o segredo — nem um pedaço; o
 *                          front não o exibe, e fatiar o ciphertext seria vazar
 *                          ruído sem propósito.
 *   par id×segredo        → id e segredo saem do MESMO sub-app; misturar o id de
 *                          um com o segredo de outro faz o Meta recusar a troca.
 *
 * A ida-e-volta da cifra em si está em tokenEncryption.test.js; o round-trip do
 * `__mapp_` no state (qual app o callback usa) está em oauthCallbackState.test.js.
 * Aqui o foco é o encanamento do segredo do App Meta.
 */

const fs   = require('fs');
const path = require('path');
const ler  = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('o segredo do App Meta é cifrado em repouso', () => {
  const rotas = ler('../src/routes/metaAppRoutes.js');

  test('o módulo de cifra é importado', () => {
    expect(rotas).toContain("require('../services/tokenEncryption')");
  });

  test('criar cifra o App Secret antes de gravar', () => {
    expect(rotas).toContain('encrypt(appSecret.trim())');
  });

  test('editar cifra o novo App Secret quando um é enviado', () => {
    expect(rotas).toMatch(/doc\.appSecret\s*=\s*encrypt\(appSecret\.trim\(\)\)/);
  });

  test('o segredo do sub-app Instagram também é cifrado (criar e editar)', () => {
    expect(rotas).toMatch(/instagramAppSecret:\s*encrypt\(/);
    expect(rotas).toMatch(/doc\.instagramAppSecret\s*=\s*encrypt\(instagramAppSecret\.trim\(\)\)/);
  });
});

describe('a API nunca devolve o segredo', () => {
  const rotas = ler('../src/routes/metaAppRoutes.js');

  test('o mask NÃO fatia o valor guardado (que agora é ciphertext)', () => {
    // O defeito que isto evita: `s.slice(0,4)+…+s.slice(-4)` mostraria pedaços
    // do ciphertext — ruído, e um hábito perigoso de "quase" expor segredo.
    expect(rotas).not.toMatch(/return s\.slice\(0, 4\)/);
    expect(rotas).toMatch(/function mask\(s\)\s*\{\s*return s \?/);
  });

  test('toda resposta que carrega o segredo passa pelo mask', () => {
    // Nenhuma rota devolve doc.appSecret cru.
    expect(rotas).not.toMatch(/appSecret:\s*(a|app|doc)\.appSecret[^)]/);
    const ocorrencias = rotas.match(/appSecret:\s*mask\(/g) || [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2); // GET-list e create/patch
  });
});

describe('o fluxo OAuth decifra o segredo do app antes de usar', () => {
  const oauth = ler('../src/routes/oauthRoutes.js');
  const fn = oauth.slice(
    oauth.indexOf('async function resolveMetaApp'),
    oauth.indexOf('async function resolveMetaApp') + 900,
  );

  test('resolveMetaApp decifra o segredo', () => {
    expect(fn).toContain("require('../services/tokenEncryption')");
    expect(fn).toMatch(/appSecret:\s*decrypt\(/);
  });

  test('id e segredo saem do MESMO sub-app', () => {
    // Só usa o par Instagram quando AMBOS existem; senão, o par principal.
    // Evita id do sub-app IG com segredo do app principal (troca recusada).
    expect(fn).toMatch(/doc\.instagramAppId\s*&&\s*doc\.instagramAppSecret/);
  });
});
