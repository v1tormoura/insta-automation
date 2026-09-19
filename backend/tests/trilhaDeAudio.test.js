'use strict';

/**
 * Trilha de fundo (2ª camada de áudio) do editor de vídeo.
 *
 * O que estes testes protegem: a trilha só entra se o arquivo EXISTIR no disco
 * do container. Durante muito tempo um caminho errado fazia o render seguir
 * mudo — sem erro, sem log —, e o vídeo saía sem a camada com todo mundo
 * achando que tinha saído com ela. O aviso no log é a parte que não pode
 * sumir numa refatoração; a mixagem em si é a parte que não pode quebrar.
 */

const path = require('path');
const { buildFilterComplex } = require('../src/services/renderEngine/filterBuilder');

/* Qualquer arquivo que exista serve: o builder só pergunta ao fs se o caminho
   está lá — quem valida se é áudio de verdade é o ffmpeg, mais adiante. */
const ARQUIVO_QUE_EXISTE = __filename;
const ARQUIVO_QUE_NAO_EXISTE = path.join(__dirname, 'trilha-que-nunca-existiu.mp3');

function montar(audio) {
  return buildFilterComplex(
    { canvas: { width: 1080, height: 1920 }, elements: [{ type: 'video', fit: 'cover' }], audio },
    { VIDEO: '/app/uploads/entrada.mp4' },
  );
}

describe('2ª camada de áudio — quando a trilha entra', () => {
  test('sem trilha, o áudio original passa direto', () => {
    const r = montar({ keepOriginal: true, originalVolume: 1 });
    expect(r.audioMap).toBe('0:a?');
    expect(r.filterComplex).not.toContain('amix');
    expect(r.inputs).toEqual(['/app/uploads/entrada.mp4']);
  });

  test('trilha existente vira input extra e amix', () => {
    const r = montar({ keepOriginal: true, originalVolume: 1, musicTrack: ARQUIVO_QUE_EXISTE, musicVolume: 0.15 });
    expect(r.inputs).toEqual(['/app/uploads/entrada.mp4', ARQUIVO_QUE_EXISTE]);
    expect(r.audioMap).toBe('[a_out]');
    /* duration=first e nao o padrao longest: musica mais longa que o video
       geraria um arquivo do tamanho da MUSICA, com o video congelado no fim. */
    expect(r.filterComplex).toContain('amix=inputs=2:duration=first:normalize=0');
    // Os dois volumes chegam ao ffmpeg como o usuário deixou nos sliders.
    expect(r.filterComplex).toContain('[0:a]volume=1[ao0]');
    expect(r.filterComplex).toContain('volume=0.15[ao1]');
  });

  test('o índice da trilha acompanha os inputs que já existem', () => {
    // Com template PNG ou imagens sobrepostas o áudio não é mais o input 1.
    const r = montar({ keepOriginal: true, musicTrack: ARQUIVO_QUE_EXISTE });
    const idx = r.inputs.indexOf(ARQUIVO_QUE_EXISTE);
    expect(r.filterComplex).toContain(`[${idx}:a]volume=`);
  });

  test('keepOriginal=false sem trilha é reportado como sem áudio', () => {
    const r = montar({ keepOriginal: false });
    // Sem trilha e sem original: mudo de propósito.
    expect(r.temAudio).toBe(false);
  });
});

describe('2ª camada de áudio — SUBSTITUINDO o original', () => {
  /* `keepOriginal: false` + trilha virava `-an`: descartava tudo, inclusive a
     trilha, e o vídeo saía mudo — o oposto do que a caixa desmarcada quer
     dizer. É o caminho do template de repost com música. */
  test('sem original e com trilha, a saída TEM áudio: só a trilha', () => {
    const r = montar({ keepOriginal: false, musicTrack: ARQUIVO_QUE_EXISTE, musicVolume: 1 });
    expect(r.temAudio).toBe(true);
    expect(r.audioMap).toBe('[a_out]');
    expect(r.filterComplex).not.toContain('amix');
    expect(r.filterComplex).not.toContain('[0:a]');
    expect(r.filterComplex).toContain('volume=1,apad[a_out]');
  });

  test('a trilha é preenchida com silêncio e o vídeo manda no fim', () => {
    // apad estende a trilha para sempre; -shortest corta no fim do vídeo.
    // Sem os dois, música de 3 min = arquivo de 3 min.
    const r = montar({ keepOriginal: false, musicTrack: ARQUIVO_QUE_EXISTE });
    expect(r.filterComplex).toContain('apad');
    expect(r.cortarNoMaisCurto).toBe(true);
  });

  test('misturando, NÃO pede -shortest — o amix já limita ao original', () => {
    /* -shortest no caminho de mistura poderia cortar um vídeo cujo áudio
       original termina antes da imagem. */
    const r = montar({ keepOriginal: true, musicTrack: ARQUIVO_QUE_EXISTE });
    expect(r.cortarNoMaisCurto).toBe(false);
  });

  test('sem original e SEM trilha, aí sim sai mudo — e é o que foi pedido', () => {
    const r = montar({ keepOriginal: false });
    expect(r.temAudio).toBe(false);
  });

  test('o renderService respeita a flag', () => {
    const fs = require('fs');
    const fonte = fs.readFileSync(path.resolve(__dirname, '../src/services/renderEngine/renderService.js'), 'utf8');
    expect(fonte).toContain("temAudio ? '-map' : '-an'");
    expect(fonte).toContain("cortarNoMaisCurto ? ['-shortest'] : []");
    expect(fonte).not.toContain('hasOriginalAudio');
  });
});

describe('2ª camada de áudio — quando a trilha NÃO entra', () => {
  let avisos;
  beforeEach(() => { avisos = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { avisos.mockRestore(); });

  test('caminho que não existe não quebra o render, mas avisa no log', () => {
    const r = montar({ keepOriginal: true, musicTrack: ARQUIVO_QUE_NAO_EXISTE, musicVolume: 0.3 });

    // O lote não pode ser perdido por causa de um caminho errado.
    expect(r.audioMap).toBe('0:a?');
    expect(r.filterComplex).not.toContain('amix');
    expect(r.inputs).toEqual(['/app/uploads/entrada.mp4']);

    // Mas tem que dar para descobrir por quê.
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(String(avisos.mock.calls[0][0])).toContain(ARQUIVO_QUE_NAO_EXISTE);
  });

  test('variável não resolvida não é caminho errado — não avisa', () => {
    // `{{TRILHA}}` sem valor é template incompleto, não engano do usuário.
    const r = montar({ keepOriginal: true, musicTrack: '{{TRILHA}}' });
    expect(r.audioMap).toBe('0:a?');
    expect(avisos).not.toHaveBeenCalled();
  });

  test('trilha vazia não avisa', () => {
    montar({ keepOriginal: true, musicTrack: '' });
    expect(avisos).not.toHaveBeenCalled();
  });
});

describe('rota de upload da trilha', () => {
  test('/upload-audio é registrada ANTES de /:id', () => {
    /* Se `/:id` vier primeiro, o Express casa "upload-audio" como um id e o
       upload responde 404 — foi por isso que a rota do PNG ganhou um comentário
       gritando no arquivo. */
    const router = require('../src/routes/videoTemplateRoutes');
    const caminhos = router.stack.filter(l => l.route).map(l => l.route.path);
    expect(caminhos).toContain('/upload-audio');
    expect(caminhos.indexOf('/upload-audio')).toBeLessThan(caminhos.indexOf('/:id'));
  });
});
