import { describe, test, expect, beforeAll } from 'vitest';
import en from './en.json';
import es from './es.json';
import { traduzirTexto, _usarDicionario } from './tradutor';

/*
 * O que estes testes protegem:
 *   frase inteira        → vem do dicionário
 *   espaços das pontas   → preservados (o React junta nós de texto por eles)
 *   caixa diferente      → "HOJE" e "agora" usam a mesma entrada de "Hoje"/"Agora"
 *   partes variáveis     → números e nomes passam, o resto é traduzido
 *   padrão curto         → "{} dias" não engole uma frase inteira
 *   sem tradução         → devolve null (o texto fica como está)
 */

describe('inglês', () => {
  beforeAll(() => _usarDicionario(en, 'en'));

  test('frase do dicionário, com os espaços das pontas', () => {
    expect(traduzirTexto('Conectar Contas (OAuth)')).toBe('Connect Accounts (OAuth)');
    expect(traduzirTexto('  Salvar dados ')).toBe('  Save details ');
  });

  test('outra caixa usa a mesma entrada', () => {
    expect(traduzirTexto('HOJE')).toBe('TODAY');
    expect(traduzirTexto('agora')).toBe('now');
  });

  test('padrão com números e nomes', () => {
    expect(traduzirTexto('3 selecionado(s)')).toBe('3 selected');
    expect(traduzirTexto('Reconectar @loja')).toBe('Reconnect @loja');
    expect(traduzirTexto('5 postagens concluídas e 2 falhas nos últimos 30 dias.'))
      .toBe('5 posts completed and 2 failures in the last 30 days.');
  });

  test('padrão aninhado traduz a parte de dentro', () => {
    expect(traduzirTexto('2 de 4 conta(s) saudáveis. Nenhuma banida. 1 com token expirado.'))
      .toBe('2 of 4 account(s) healthy. None banned. 1 with expired token.');
  });

  test('rótulo: valor', () => {
    expect(traduzirTexto('Atenção: 1')).toBe('Attention: 1');
  });

  test('o que não está no dicionário fica como está', () => {
    expect(traduzirTexto('@tatiane.sobral7294')).toBeNull();
    expect(traduzirTexto('Minha legenda qualquer sobre a praia')).toBeNull();
  });
});

describe('espanhol', () => {
  beforeAll(() => _usarDicionario(es, 'es'));
  test('frase e padrão', () => {
    expect(traduzirTexto('Conectar Contas (OAuth)')).toBe('Conectar Cuentas (OAuth)');
    expect(traduzirTexto('há 3 dias')).toBe('hace 3 días');
  });
});

describe('português', () => {
  beforeAll(() => _usarDicionario(null));
  test('sem dicionário, nada muda', () => {
    expect(traduzirTexto('Conectar Contas (OAuth)')).toBeNull();
  });
});
