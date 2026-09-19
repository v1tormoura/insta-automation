'use strict';

/**
 * Teto de vídeos por lote no editor.
 *
 * O que estes testes protegem: o limite existe em DOIS lugares — o multer, que
 * recusa, e a tela, que avisa antes de subir. Quando os dois discordam acontece
 * o pior caso: a tela deixa enviar, o usuário espera o upload inteiro de dezenas
 * de arquivos, e só no fim recebe a recusa. Foi exatamente assim que apareceu,
 * com 53 vídeos e um "Too many files" cru em inglês.
 */

jest.mock('../src/queue/videoRenderQueue', () => ({ add: jest.fn(), getJob: jest.fn() }));

const fs   = require('fs');
const path = require('path');
const ctrl = require('../src/controllers/videoBatchController');

describe('teto de arquivos por lote', () => {
  test('o limite é exportado e comporta um lote real', () => {
    // 53 vídeos — o caso que quebrou — tem que caber com folga.
    expect(ctrl.MAX_ARQUIVOS_POR_LOTE).toBeGreaterThanOrEqual(53);
  });

  test('a tela usa o MESMO número do backend', () => {
    /* Duplicar a constante é aceitável (front e back não compartilham módulo),
       divergir não é: é o que faz a tela prometer um envio que o servidor
       recusa depois de recebê-lo inteiro. */
    const tela = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/src/pages/VideoEditorPage.jsx'), 'utf8');
    const m = tela.match(/const MAX_LOTE = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(ctrl.MAX_ARQUIVOS_POR_LOTE);
  });
});

describe('erro de upload em português', () => {
  test('arquivos demais diz quantos cabem', () => {
    const msg = ctrl.mensagemDoErroDeUpload({ code: 'LIMIT_FILE_COUNT' });
    expect(msg).toContain(String(ctrl.MAX_ARQUIVOS_POR_LOTE));
    expect(msg).not.toMatch(/too many/i);
  });

  test('arquivo grande demais diz o tamanho máximo', () => {
    const msg = ctrl.mensagemDoErroDeUpload({ code: 'LIMIT_FILE_SIZE' });
    expect(msg).toContain('500');
    expect(msg).not.toMatch(/file too large/i);
  });

  test('erro desconhecido não vira mensagem vazia', () => {
    expect(ctrl.mensagemDoErroDeUpload({ message: 'disco cheio' })).toBe('disco cheio');
    expect(ctrl.mensagemDoErroDeUpload(null)).toBeTruthy();
    expect(ctrl.mensagemDoErroDeUpload({})).toBeTruthy();
  });
});
