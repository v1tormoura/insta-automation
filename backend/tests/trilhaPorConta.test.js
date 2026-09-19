'use strict';

/**
 * Trilha de áudio por conta, na hora de publicar.
 *
 * O que estes testes protegem: a decisão de QUAL trilha cada conta recebe tem
 * que ser determinística em (publicação, conta) — retry reproduz a mesma,
 * contas diferentes tendem a receber diferentes — e a configuração vinda da
 * tela nunca pode derrubar a publicação: campo estragado vira padrão.
 *
 * O que NÃO provam: o efeito no alcance. Substituir muda o fingerprint de
 * áudio; misturar não. Isso é fato sobre a técnica, não sobre este código.
 */

const {
  normalizar, lerDoCorpo, escolher, VOLUME_MIN, VOLUME_MAX, VOLUME_PADRAO,
} = require('../src/services/trilhaPorConta');

const ID_A = '64a000000000000000000001';
const ID_B = '64a000000000000000000002';
const ID_C = '64a000000000000000000003';
const docs = [
  { _id: ID_A, nome: 'Lo-fi calmo',  arquivo: 'trilhas/aud_a.mp3' },
  { _id: ID_B, nome: 'Beat leve',    arquivo: 'trilhas/aud_b.mp3' },
  { _id: ID_C, nome: 'Piano',        arquivo: 'trilhas/aud_c.mp3' },
];

/** Gerador determinístico para os testes (mulberry32 — sementes pequenas já
    espalham na primeira saída, o que um LCG cru não faz). */
function aleatorioDe(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('normalizar — nunca lança, campo ruim vira padrão', () => {
  test('modo desconhecido vira nenhuma', () => {
    expect(normalizar({ modo: 'explodir' }).modo).toBe('nenhuma');
    expect(normalizar(null).modo).toBe('nenhuma');
    expect(normalizar('lixo').modo).toBe('nenhuma');
  });

  test('só ids com cara de ObjectId sobrevivem, sem repetição', () => {
    const c = normalizar({ modo: 'substituir', ids: [ID_A, 'abc', ID_A, '', null, ID_B] });
    expect(c.ids).toEqual([ID_A, ID_B]);
  });

  test('volume é preso à faixa; ausente cai no padrão do modo', () => {
    expect(normalizar({ modo: 'substituir', volume: 99 }).volume).toBe(VOLUME_MAX);
    expect(normalizar({ modo: 'substituir', volume: 0.001 }).volume).toBe(VOLUME_MIN);
    expect(normalizar({ modo: 'substituir' }).volume).toBe(VOLUME_PADRAO.substituir);
    expect(normalizar({ modo: 'misturar' }).volume).toBe(VOLUME_PADRAO.misturar);
    // Misturar por padrão é FUNDO — se viesse em 100% cobriria a fala.
    expect(VOLUME_PADRAO.misturar).toBeLessThanOrEqual(0.3);
  });
});

describe('lerDoCorpo — o que vem do multipart', () => {
  test('JSON em string é aceito; vazio e inválido viram null', () => {
    expect(lerDoCorpo(JSON.stringify({ modo: 'substituir', ids: [ID_A] }))).toMatchObject({ modo: 'substituir', ids: [ID_A] });
    expect(lerDoCorpo('')).toBeNull();
    expect(lerDoCorpo('   ')).toBeNull();
    expect(lerDoCorpo('{nao e json')).toBeNull();
    expect(lerDoCorpo(undefined)).toBeNull();
  });

  test('modo nenhuma ou sem trilha escolhida não vai para o job', () => {
    // Guardar isso no job só criaria um campo que o publicador teria de ignorar.
    expect(lerDoCorpo({ modo: 'nenhuma', ids: [ID_A] })).toBeNull();
    expect(lerDoCorpo({ modo: 'substituir', ids: [] })).toBeNull();
    expect(lerDoCorpo({ modo: 'substituir', ids: ['lixo'] })).toBeNull();
  });
});

describe('escolher — qual trilha cada conta recebe', () => {
  test('uma trilha só: sempre ela', () => {
    for (let i = 0; i < 20; i++) {
      const t = escolher({ modo: 'substituir', ids: [ID_B] }, docs, aleatorioDe(i));
      expect(t.arquivo).toBe('trilhas/aud_b.mp3');
      expect(t.nome).toBe('Beat leve');
      expect(t.modo).toBe('substituir');
    }
  });

  test('a mesma semente dá a mesma trilha — retry reproduz', () => {
    const cfg = { modo: 'substituir', ids: [ID_A, ID_B, ID_C] };
    for (const s of [1, 7, 42, 999, 123456]) {
      expect(escolher(cfg, docs, aleatorioDe(s)).arquivo).toBe(escolher(cfg, docs, aleatorioDe(s)).arquivo);
    }
  });

  test('sementes diferentes espalham entre as trilhas', () => {
    const cfg = { modo: 'substituir', ids: [ID_A, ID_B, ID_C] };
    const vistas = new Set();
    for (let s = 1; s <= 40; s++) vistas.add(escolher(cfg, docs, aleatorioDe(s)).arquivo);
    expect(vistas.size).toBe(3);
  });

  test('a ordem dos ids pedidos manda, não a ordem do banco', () => {
    /* O sorteio é um índice sobre a lista. Se a lista viesse na ordem que o
       banco devolveu, a mesma semente daria trilhas diferentes de uma consulta
       para outra — e o retry publicaria outra trilha. */
    const cfg = { modo: 'substituir', ids: [ID_C, ID_A, ID_B] };
    const invertidos = [...docs].reverse();
    expect(escolher(cfg, docs, aleatorioDe(5)).arquivo).toBe(escolher(cfg, invertidos, aleatorioDe(5)).arquivo);
  });

  test('id pedido que não existe mais no banco é ignorado', () => {
    const t = escolher({ modo: 'misturar', ids: ['64a0000000000000000000ff', ID_A] }, docs, aleatorioDe(3));
    expect(t.arquivo).toBe('trilhas/aud_a.mp3');
  });

  test('nenhuma trilha válida: null, e quem chama publica sem trilha', () => {
    expect(escolher({ modo: 'substituir', ids: ['64a0000000000000000000ff'] }, docs, aleatorioDe(1))).toBeNull();
    expect(escolher({ modo: 'substituir', ids: [ID_A] }, [], aleatorioDe(1))).toBeNull();
    expect(escolher({ modo: 'nenhuma', ids: [ID_A] }, docs, aleatorioDe(1))).toBeNull();
  });

  test('o volume normalizado acompanha a escolha', () => {
    expect(escolher({ modo: 'misturar', ids: [ID_A], volume: 0.15 }, docs, aleatorioDe(1)).volume).toBe(0.15);
    expect(escolher({ modo: 'misturar', ids: [ID_A] }, docs, aleatorioDe(1)).volume).toBe(VOLUME_PADRAO.misturar);
  });
});

describe('a rota da biblioteca', () => {
  test('está registrada no app atrás de autenticação', () => {
    const fs = require('fs');
    const path = require('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
    expect(app).toMatch(/app\.use\('\/trilhas',\s*auth,\s*require\('\.\/routes\/trilhaRoutes'\)\)/);
  });
});

describe('o conversor recebe a trilha', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(path.resolve(__dirname, '../src/services/videoProcessor.js'), 'utf8');

  test('substituir: mapeia vídeo do input 0 e áudio do input 1, com apad e -shortest', () => {
    expect(fonte).toContain("['-map', '0:v:0', '-map', '1:a:0', '-af', `volume=${vol},apad`, '-shortest']");
  });

  test('misturar: amix com duration=first — a música nunca estica o vídeo', () => {
    expect(fonte).toContain('amix=inputs=2:duration=first:normalize=0[a_out]');
  });

  test('a segunda entrada vem DEPOIS do seekInput — o -ss é do vídeo', () => {
    // Dois comandos (principal e fallback), os dois embrulhados na mesma ordem.
    expect(fonte.split('comTrilha(cortaInicio(ffmpeg(inputPath)))').length - 1).toBe(2);
  });

  test('a trilha entra na digital do nome do arquivo', () => {
    expect(fonte).toMatch(/options\.trilha && options\.trilha\.caminho\s*\?\s*JSON\.stringify/);
  });
});
