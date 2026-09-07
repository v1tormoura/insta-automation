import { describe, test, expect } from 'vitest';
import { contaValida, montarLinkGuiado } from './conexaoGuiada.js';

/**
 * O link guiado.
 *
 * ── Por que ele existe
 *
 * Enquanto o app da Meta está em desenvolvimento, só conta com papel de
 * TESTADOR consegue autorizá-lo. O link de autorização cru cai direto no
 * Instagram, e ali a conta que não é testadora recebe um erro que não diz o que
 * faltou. O link guiado aponta para uma página nossa que mostra os dois passos
 * na ordem certa.
 *
 * ── O que quebra calado aqui
 *
 *   `state` com texto de fora   → vai numa requisição e volta assinado pelo
 *                                 servidor; id inventado falha no callback, e o
 *                                 sintoma não se liga ao endereço colado
 *   origem de variável de amb.  → um build servido de outro domínio mandaria a
 *                                 pessoa para localhost
 *   `app=` vazio na URL         → o servidor procuraria um MetaApp de id vazio
 *                                 em vez de usar o padrão
 */

describe('o que pode virar state de OAuth', () => {
  test('ObjectId passa como veio', () => {
    const id = '64b000000000000000000001';
    expect(contaValida(id)).toBe(id);
    expect(contaValida(id.toUpperCase())).toBe(id.toUpperCase());
  });

  test('conta nova é o padrão', () => {
    expect(contaValida('new')).toBe('new');
    expect(contaValida('')).toBe('new');
    expect(contaValida('   ')).toBe('new');
    expect(contaValida(null)).toBe('new');
    expect(contaValida(undefined)).toBe('new');
  });

  test('o que não é ObjectId cai em new, não passa adiante', () => {
    /* Cai em vez de lançar: no pior caso a pessoa conecta uma conta a mais, em
       vez de a tela não abrir. */
    for (const v of [
      'admin', '../../etc/passwd', '<script>', '64b00000000000000000000',   // 23 dígitos
      '64b0000000000000000000012', 'zzzzzzzzzzzzzzzzzzzzzzzz', 42, {}, [],
    ]) {
      expect(contaValida(v)).toBe('new');
    }
  });

  test('id com caractere fora do hexa não passa', () => {
    /* 24 caracteres, mas com um 'g' — comprimento certo não é validação. */
    expect(contaValida('64b00000000000000000000g')).toBe('new');
  });
});

describe('o endereço da página guiada', () => {
  const ORIGEM = 'https://instaflow.pro';

  test('aponta para /conectar na mesma origem', () => {
    expect(montarLinkGuiado(ORIGEM, 'new')).toBe('https://instaflow.pro/conectar?conta=new');
  });

  test('carrega a conta a reconectar', () => {
    const id = '64b000000000000000000001';
    expect(montarLinkGuiado(ORIGEM, id)).toContain(`conta=${id}`);
  });

  test('id inventado não chega ao link', () => {
    expect(montarLinkGuiado(ORIGEM, '../../admin')).toBe('https://instaflow.pro/conectar?conta=new');
  });

  test('o App só entra quando existe', () => {
    /* `app=` vazio faria o servidor procurar um MetaApp de id vazio em vez de
       cair no padrão. */
    expect(montarLinkGuiado(ORIGEM, 'new', '')).not.toContain('app=');
    expect(montarLinkGuiado(ORIGEM, 'new', '   ')).not.toContain('app=');
    expect(montarLinkGuiado(ORIGEM, 'new', null)).not.toContain('app=');
    expect(montarLinkGuiado(ORIGEM, 'new', 'abc123')).toContain('app=abc123');
  });

  test('barra sobrando na origem não vira barra dupla', () => {
    expect(montarLinkGuiado('https://instaflow.pro/', 'new')).toBe('https://instaflow.pro/conectar?conta=new');
  });

  test('funciona em localhost com porta', () => {
    /* É como a tela é acessada em desenvolvimento. */
    expect(montarLinkGuiado('http://localhost:5200', 'new')).toBe('http://localhost:5200/conectar?conta=new');
  });

  test('o link é sempre absoluto — vai ser colado em outro navegador', () => {
    /* Um caminho relativo colado noutro navegador não resolve para nada. */
    const link = montarLinkGuiado(ORIGEM, 'new', 'a1');
    expect(link.startsWith('http')).toBe(true);
    expect(() => new URL(link)).not.toThrow();
  });
});
