'use strict';

/**
 * Extração do sessionid do que a pessoa COLA.
 *
 * Conectar por Session ID é o caminho que funciona quando o login por senha
 * está bloqueado — e a etapa que mais falhava não era técnica, era humana:
 * a pessoa colava a linha inteira do cookie, ou o `document.cookie` todo, ou
 * o valor entre aspas, e recebia "sessionid não informado". O dado estava
 * lá; só não sozinho. Estes casos são exatamente os que apareciam no suporte.
 */

/* O módulo é um router do Express que, ao ser exigido, cria conexões e lê env.
   Só interessa a função exportada à parte — mockar o resto evita puxar o
   mundo. */
jest.mock('../src/models/Account', () => ({}), { virtual: true });

const { _extrairSessionid } = require('../src/routes/accountRoutes');

const VALIDO = '61887766%3AAbCdEf12345%3A9';
const DECOD  = '61887766:AbCdEf12345:9';

describe('extrairSessionid', () => {
  test('o valor puro, url-encoded, passa e é decodificado', () => {
    expect(_extrairSessionid(VALIDO)).toBe(DECOD);
  });

  test('o valor já decodificado passa inalterado', () => {
    expect(_extrairSessionid(DECOD)).toBe(DECOD);
  });

  test('a linha "sessionid=..." do DevTools', () => {
    expect(_extrairSessionid(`sessionid=${VALIDO}`)).toBe(DECOD);
  });

  test('o document.cookie inteiro — pesca o sessionid no meio', () => {
    const blob = `ig_did=ABC-123; csrftoken=xyz; sessionid=${VALIDO}; rur=CLN`;
    expect(_extrairSessionid(blob)).toBe(DECOD);
  });

  test('sessionid no meio do blob, sem o rótulo "sessionid="', () => {
    // Colou vários valores sem a chave; reconhece pelo formato do token.
    const blob = `ABC-123 xyz ${VALIDO} CLN`;
    expect(_extrairSessionid(blob)).toBe(DECOD);
  });

  test('aspas de cópia são removidas', () => {
    expect(_extrairSessionid(`"${VALIDO}"`)).toBe(DECOD);
  });

  test('espaços em volta não atrapalham', () => {
    expect(_extrairSessionid(`   ${VALIDO}   `)).toBe(DECOD);
  });

  test('vazio devolve vazio — a rota vira 400 com instrução', () => {
    expect(_extrairSessionid('')).toBe('');
    expect(_extrairSessionid(null)).toBe('');
    expect(_extrairSessionid('   ')).toBe('');
  });

  test('texto sem nenhum sessionid não inventa um', () => {
    // Não casa o formato → devolve o texto trimado, e o login falha adiante
    // com erro do Instagram, não com um sessionid forjado.
    const lixo = 'colei a coisa errada aqui';
    expect(_extrairSessionid(lixo)).toBe(lixo);
  });
});
