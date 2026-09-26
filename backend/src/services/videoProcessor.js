const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
/* NÃO usa ffmpeg-static direto: o build dele não tem o filtro `drawtext`, e a
   marca d'água (drawtext) derrubava a conversão inteira com "Filter not found".
   `ffmpegBin` escolhe um ffmpeg que tenha drawtext. Ver ffmpegBin.js. */
const { FFMPEG_BIN } = require('./ffmpegBin');

ffmpeg.setFfmpegPath(FFMPEG_BIN);

// Deduplicação de conversão concorrente: evita que dois workers convertam o mesmo arquivo simultaneamente
const _inProgress = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isVideo(file) {
  const name = file.toLowerCase();
  return name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.avi') || name.endsWith('.mkv');
}

function isImage(file) {
  const name = file.toLowerCase();
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
}

/**
 * Analisa o vídeo de entrada e retorna metadados.
 */
function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta);
    });
  });
}

/**
 * Converte vídeo para formato Reel Instagram com MÁXIMA QUALIDADE.
 *
 * Configurações de alta qualidade para viralização:
 * - Resolução: 1080×1920 (9:16 vertical)
 * - Codec: H.264 High Profile (máxima compatibilidade)
 * - CRF: 18 (quase lossless, menor = melhor qualidade)
 * - Preset: slow (melhor compressão = mais qualidade para mesmo tamanho)
 * - Bitrate áudio: 192k AAC (alta fidelidade)
 * - Sample rate: 44100 Hz (padrão Instagram)
 * - Pixel format: yuv420p (compatível universalmente)
 * - movflags: +faststart (streaming eficiente)
 * - Profile: high (H.264 High = melhor qualidade)
 */
function convertToReelFormat(inputPath, options = {}) {
  if (!isVideo(inputPath)) return Promise.resolve(inputPath);

  const outputDir = path.resolve(__dirname, '../../uploads/processed');
  ensureDir(outputDir);

  const filename = path.basename(inputPath, path.extname(inputPath));
  const quality = options.quality || 'high';
  const processMode = options.processMode || 'sem_limpeza';

  /* ── Por que a aleatoriedade entra por fora ──────────────────────────────

     As variações que tornam o arquivo único (micro-crop, jitter de cor, pitch,
     CRF) usavam `Math.random()` direto. Isso tem duas consequências ruins.

     A primeira: não dá para testar. Um teste sobre "o filtro varia" que sorteia
     de verdade ou passa por acidente ou falha por acidente.

     A segunda, que é a que importa em produção: uma reexecução gera um arquivo
     DIFERENTE do que já subiu. Se a publicação falhou depois do upload e antes
     de registrar, a tentativa seguinte manda outro vídeo — e a conta acaba com
     dois reels quase iguais, que é pior do que o problema original.

     Com a semente vinda de fora, o par (post, conta) sempre produz o mesmo
     arquivo, e contas diferentes produzem arquivos diferentes. Determinístico
     onde precisa ser, único onde precisa ser. */
  const aleatorio = typeof options.aleatorio === 'function' ? options.aleatorio : Math.random;

  /* Sufixo de fora quando o chamador precisa de um arquivo por conta: sem
     isso, duas contas convertendo o mesmo vídeo no mesmo milissegundo
     escreveriam no mesmo caminho, e uma sobrescreveria a outra no meio da
     leitura da primeira. */
  let suffix = options.sufixo ? `-${options.sufixo}` : null;
  if (suffix) { /* já definido pelo chamador */ }
  else if (processMode === 'limpeza_leve') {
    suffix = `-reel-clean-${Date.now().toString(36).slice(-5)}`;
  } else if (processMode === 'ultra_clean') {
    suffix = `-reel-ultra-${Date.now().toString(36).slice(-5)}`;
  } else if (processMode === 'humanizador') {
    suffix = `-reel-human-${Date.now().toString(36).slice(-6)}`;
  } else {
    suffix = quality === 'max' ? '-reel-max' : quality === 'fast' ? '-reel-fast' : '-reel-hq';
  }

  /* ── A marca entra no nome do arquivo ────────────────────────────────────

     `sem_limpeza` reaproveita o arquivo já convertido quando o caminho de saída
     existe. Com marca d'água isso vira o pior defeito possível deste sistema:
     duas contas com o mesmo vídeo compartilhariam `foo-reel-hq.mp4`, e o @ da
     primeira apareceria no vídeo da segunda — a assinatura exata de que as duas
     saem do mesmo lugar.

     Hoje o caminho por conta promove os modos que não variam e sempre manda um
     `sufixo` próprio, então não passa por aqui. Mas depender disso é depender de
     um detalhe de outro módulo: com a marca no nome, o cache continua correto
     por construção, para qualquer chamador. */
  const porConta = [
    typeof options.marcaDagua === 'string' ? options.marcaDagua.trim() : '',
    Array.isArray(options.metadados) ? options.metadados.join('|') : '',
    /* A edição entra na digital do nome: sem ela, dois arquivos com a mesma
       semente mas cortes/ganchos diferentes disputariam o MESMO caminho de
       saída, e um sobrescreveria o outro. */
    options.variacao ? JSON.stringify(options.variacao) : '',
    typeof options.ganchoFiltro === 'string' ? options.ganchoFiltro : '',
    /* Trilhas diferentes = arquivos diferentes; sem isto duas contas com
       trilhas distintas disputariam o mesmo caminho de saída. */
    options.trilha && options.trilha.caminho
      ? JSON.stringify({ t: options.trilha.caminho, m: options.trilha.modo, v: options.trilha.volume })
      : '',
  ].filter(Boolean).join('||');
  if (porConta) {
    const digital = require('crypto')
      .createHash('sha256').update(porConta).digest('hex').slice(0, 8);
    suffix += `-m${digital}`;
  }

  const outputPath = path.join(outputDir, `${filename}${suffix}.mp4`);

  // Cache + deduplicação apenas para sem_limpeza (os outros modos geram arquivo único por design)
  if (processMode === 'sem_limpeza') {
    if (fs.existsSync(outputPath)) {
      console.log(`♻️ Reutilizando vídeo já convertido: ${path.basename(outputPath)}`);
      return Promise.resolve(outputPath);
    }
    // Se conversão já está em progresso para este arquivo, aguarda a mesma Promise
    if (_inProgress.has(outputPath)) {
      console.log(`⏳ Aguardando conversão em progresso: ${path.basename(outputPath)}`);
      return _inProgress.get(outputPath);
    }
  }

  const promise = new Promise(async (resolve, reject) => {

    // Detecta orientação do vídeo original
    let probe;
    try { probe = await probeVideo(inputPath); } catch {}
    const vStream = probe?.streams?.find(s => s.codec_type === 'video');
    const w = vStream?.width || 1080;
    const h = vStream?.height || 1920;
    const isPortrait = h > w;

    // Parâmetros por nível de qualidade
    const configs = {
      max: {
        crf: '15',        // Quase lossless
        preset: 'slow',
        audioBitrate: '256k',
        description: 'Máxima qualidade (arquivo maior)',
      },
      high: {
        crf: '18',        // Alta qualidade, excelente para redes sociais
        preset: 'slow',
        audioBitrate: '192k',
        description: 'Alta qualidade (recomendado)',
      },
      fast: {
        crf: '23',        // Padrão - processamento rápido
        preset: 'veryfast',
        audioBitrate: '128k',
        description: 'Qualidade padrão (processamento rápido)',
      },
    };

    const cfg = configs[quality] || configs.high;

    /* ── Upscale: Lanczos no lugar do bicúbico padrão do ffmpeg ─────────────

       `flags=lanczos` troca só o ALGORITMO de reamostragem — mesma escala,
       mesmo tamanho de saída, sem custo de processamento perceptível (é outra
       fórmula de interpolação, não um passo extra) e sem depender de GPU ou
       de um modelo de IA. Onde mais aparece: fonte abaixo de 1080×1920 (o
       caso comum de conteúdo baixado/reaproveitado) ganha bordas mais
       definidas que o bicúbico borra; fonte já em alta resolução não perde
       nada.

       O `unsharp` logo abaixo, depois de toda variação de conta, é a segunda
       metade do upscale: realça o detalhe que o reescalonamento por si só não
       traz de volta. Valores moderados de propósito — luma mais forte que
       chroma, porque nitidez em excesso na cor vira franja visível ao redor
       de bordas, o efeito "over-sharpened" que denuncia processamento. */
    // Filtro de escala: preserva conteúdo original, faz pad se necessário
    // Para vídeos vertical já em 9:16, evita crop agressivo
    let scaleFilter;
    if (isPortrait && Math.abs(w / h - 1080 / 1920) < 0.05) {
      // Já está em 9:16 — só redimensiona sem crop
      scaleFilter = 'scale=1080:1920:flags=lanczos:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
    } else {
      // Converte para 9:16 com crop centrado (padrão Reels)
      scaleFilter = 'scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1920';
    }

    // Ultra clean: micro-variação de brilho garante hash de pixel único por publicação
    if (processMode === 'ultra_clean') {
      const micro = (aleatorio() * 0.004 + 0.001).toFixed(5);
      scaleFilter += `,eq=brightness=${micro}`;
    }

    // Humanizador: transformações invisíveis que tornam o vídeo único em múltiplas dimensões
    let humanAudioFilter = null;
    if (processMode === 'humanizador') {
      // Micro-crop aleatório (2-5px) + resize de volta — desloca todos os pixels
      const cropPx = Math.floor(aleatorio() * 4) + 2;
      const cropX  = Math.floor(aleatorio() * (cropPx + 1));
      const cropY  = Math.floor(aleatorio() * (cropPx + 1));
      // Micro-ajuste de cor imperceptível
      const microBright = ((aleatorio() - 0.5) * 0.006).toFixed(5);
      const microSat    = (1 + (aleatorio() - 0.5) * 0.04).toFixed(4);
      const microContr  = (1 + (aleatorio() - 0.5) * 0.02).toFixed(4);
      scaleFilter += `,crop=iw-${cropPx}:ih-${cropPx}:${cropX}:${cropY},scale=1080:1920:flags=lanczos,eq=brightness=${microBright}:saturation=${microSat}:contrast=${microContr}`;
      // Pitch de áudio micro-shift (±0.5%) — muda fingerprint de áudio sem ser audível
      const pitchFactor = (1 + (aleatorio() - 0.5) * 0.01).toFixed(5);
      const newRate     = Math.round(44100 * Number(pitchFactor));
      humanAudioFilter  = `asetrate=${newRate},aresample=44100`;
    }

    /* ── Nitidez, depois de toda variação de conta ───────────────────────

       Depois do crop+reescala do humanizador (que já usa Lanczos) e não
       antes: nitidez aplicada e depois borrada de novo pelo segundo `scale`
       teria sido trabalho perdido. Antes da marca d'água — texto sintético já
       nasce no contraste máximo, e realçar nitidez em cima dele só arrisca
       franja ao redor das letras sem ganhar nada, já que não há detalhe
       nenhum ali para recuperar. */
    scaleFilter += ',unsharp=5:5:0.6:5:5:0.3';

    /* ── A marca d'água, no fim da cadeia ────────────────────────────────

       Por último de propósito: o humanizador corta alguns pixels e volta a
       escalar para 1080×1920, e uma marca desenhada antes disso seria cortada
       junto — de um jeito diferente em cada conta, porque o corte é semeado.
       Desenhada depois, ela cai no mesmo lugar sempre.

       Vem por `options.marcaDagua` já montada pelo chamador: o texto é o @ da
       conta, e este módulo não conhece contas. Ver `marcaDagua.js`. */
    /* ── Variação de edição por conta ────────────────────────────────────
       Vem resolvida de `variacaoDeEdicao`, semeada em (post, conta): cada
       conta recebe uma abertura e um ritmo diferentes. O corte do início não
       entra aqui — é `-ss` na ENTRADA, mais abaixo, porque cortar por filtro
       decodificaria os segundos descartados à toa. */
    const varEdicao = options.variacao || null;

    if (varEdicao && Number(varEdicao.velocidade) && Number(varEdicao.velocidade) !== 1) {
      /* `setpts` reescreve o carimbo de tempo de cada quadro: dividir acelera.
         O áudio acompanha com `atempo` lá embaixo — sem ele, a voz ficaria
         dessincronizada do vídeo. */
      scaleFilter += `,setpts=PTS/${Number(varEdicao.velocidade).toFixed(4)}`;
    }

    /* O gancho: texto grande nos primeiros segundos, o eixo que mais pesa na
       retenção — a maior parte assiste sem som, e o que segura nos 2 primeiros
       segundos é o que está escrito.

       Chega PRONTO de quem chama, exatamente como `marcaDagua`: montar
       `drawtext` exige escapar caminho de fonte e texto livre, e esse
       conhecimento já mora num módulo só (ver variacaoDeEdicao.filtroDoGancho).
       Duplicá-lo aqui seria um segundo lugar para a mesma regra de escape
       errar. */
    if (typeof options.ganchoFiltro === 'string' && options.ganchoFiltro.trim()) {
      scaleFilter += `,${options.ganchoFiltro.trim()}`;
    }

    if (typeof options.marcaDagua === 'string' && options.marcaDagua.trim()) {
      scaleFilter += `,${options.marcaDagua.trim()}`;
    }

    const modeLabel = processMode === 'limpeza_leve' ? ' [Limpeza Leve]'
                    : processMode === 'ultra_clean'  ? ' [Ultra Clean]'
                    : processMode === 'humanizador'  ? ' [Humanizador]'
                    : '';
    console.log(`🎬 Convertendo vídeo [${cfg.description}]${modeLabel}...`);
    console.log(`   Entrada: ${path.basename(inputPath)} (${w}×${h})`);
    console.log(`   Saída: ${path.basename(outputPath)}`);

    // limpeza_leve, ultra_clean e humanizador removem metadados em duas camadas:
    // Camada 1 — container e streams:
    //   -map_metadata -1      : remove tags globais do container (title, author, GPS, etc.)
    //   -map_metadata:s -1    : remove tags dos streams individuais (camera, creation_time, etc.)
    //   -map_chapters -1      : remove capítulos
    //   -fflags +bitexact     : impede o muxer de gravar creation_time e "encoder: Lavf..." no container
    //   -x264-params info=0   : impede o x264 de escrever o SEI user_data_unregistered no bitstream
    // Camada 2 — bitstream H.264 (pós-encode):
    //   -bsf:v filter_units=remove_types=6 : remove todos os NAL units SEI (type=6) do bitstream final
    //   Auditoria confirma: 1 SEI antes → 0 SEI após. Compatível com ffmpeg-static 6.1.1.
    const isCleanMode = (processMode === 'limpeza_leve' || processMode === 'ultra_clean' || processMode === 'humanizador');
    const metadataOpts = isCleanMode
      ? [
          '-map_metadata', '-1',
          '-map_metadata:s', '-1',
          '-map_chapters', '-1',
          '-fflags', '+bitexact',
          '-x264-params', 'info=0',
        ]
      : [];
    // BSF separado: deve aparecer nos outputOptions após os flags de codec
    const bitstreamOpts = isCleanMode
      ? ['-bsf:v', 'filter_units=remove_types=6']
      : [];

    // Humanizador: CRF aleatório (17–20) para encoding ligeiramente diferente a cada vez
    const finalCrf = processMode === 'humanizador'
      ? String(17 + Math.floor(aleatorio() * 4))
      : cfg.crf;

    /* O áudio precisa seguir a mesma velocidade do vídeo, senão a voz
       dessincroniza. `atempo` se soma ao pitch do humanizador quando os dois
       existem — são filtros de áudio na mesma cadeia. */
    const cadeiaAudio = [
      humanAudioFilter,
      (varEdicao && Number(varEdicao.velocidade) && Number(varEdicao.velocidade) !== 1)
        ? `atempo=${Number(varEdicao.velocidade).toFixed(4)}`
        : null,
    ].filter(Boolean).join(',');
    /* ── Trilha de áudio por conta ─────────────────────────────────────────
       Chega pronta de midiaPorConta: `{ caminho, modo, volume }`.

       substituir: o original sai. `-map` explícito (vídeo do input 0, áudio do
         input 1), `apad` estende a trilha com silêncio e `-shortest` corta no
         fim do VÍDEO — sem os dois, música de 3 min viraria arquivo de 3 min. O
         pitch do humanizador e o atempo da edição não se aplicam à trilha: ela
         não está presa a nada na imagem.

       misturar: precisa de `-filter_complex` (amix). O `-vf` continua valendo
         para o vídeo porque ele é mapeado direto do input 0, e a cadeia de
         áudio do original (pitch + atempo) entra no ramo `[0:a]` — um `-af`
         solto num stream que vem do grafo complexo é erro do ffmpeg.
         `duration=first` limita ao original, ou seja, ao vídeo. */
    const trilha = options.trilha && options.trilha.caminho ? options.trilha : null;
    let audioFilterOpts;
    if (!trilha) {
      audioFilterOpts = cadeiaAudio ? ['-af', cadeiaAudio] : [];
    } else {
      const vol = Math.min(1.5, Math.max(0.05,
        Number(trilha.volume) || (trilha.modo === 'misturar' ? 0.3 : 1))).toFixed(3);
      if (trilha.modo === 'misturar') {
        const ramoOriginal = cadeiaAudio ? `[0:a]${cadeiaAudio},volume=1[ao0]` : '[0:a]volume=1[ao0]';
        audioFilterOpts = [
          '-filter_complex',
          `${ramoOriginal};[1:a]volume=${vol}[ao1];[ao0][ao1]amix=inputs=2:duration=first:normalize=0[a_out]`,
          '-map', '0:v:0', '-map', '[a_out]',
        ];
      } else {
        audioFilterOpts = ['-map', '0:v:0', '-map', '1:a:0', '-af', `volume=${vol},apad`, '-shortest'];
      }
    }
    /* Segunda entrada DEPOIS do seekInput: o `-ss` do corte de início é opção
       da entrada mais recente no fluent-ffmpeg, e tem que ficar no vídeo. */
    const comTrilha = c => trilha ? c.input(trilha.caminho) : c;

    /* Corte do inicio: `-ss` ANTES da entrada (seekInput), nao filtro.
       Por filtro o ffmpeg decodificaria os segundos descartados so para joga-los
       fora; no seek de entrada ele pula direto, o que em lote de dezenas de
       videos e a diferenca entre segundos e minutos. */
    const cortaInicio = c => (varEdicao && Number(varEdicao.trimInicio) > 0)
      ? c.seekInput(Number(varEdicao.trimInicio))
      : c;

    comTrilha(cortaInicio(ffmpeg(inputPath)))
      .outputOptions([
        '-vf', scaleFilter,
        '-c:v', 'libx264',
        '-profile:v', 'high',           // H.264 High Profile
        '-level', '4.1',                // Nível compatível com Instagram
        '-preset', cfg.preset,
        '-crf', finalCrf,
        '-c:a', 'aac',
        '-b:a', cfg.audioBitrate,
        '-ar', '44100',
        '-ac', '2',                     // Stereo
        '-movflags', '+faststart',      // Streaming progressivo
        '-pix_fmt', 'yuv420p',
        ...metadataOpts,               // camada 1: limpa container + streams + impede SEI
        '-metadata:s:v:0', 'rotate=0', // re-adiciona só a rotação (necessário para playback)
        /* ── Camada 3: o metadado que a publicação PASSA a ter ──────────────

           Depois da limpeza, nunca antes: `-map_metadata -1` apagaria o que
           vem aqui. Medido — com `+bitexact` ativo, um `-metadata
           creation_time=` explícito ainda é gravado, no container e nos dois
           streams, e as strings de versão continuam suprimidas.

           Limpar tudo resolve metade do problema. A outra metade é que o
           arquivo ficava sem metadado NENHUM, e vídeo de celular não é assim:
           tem hora de gravação e usa os nomes de handler do Android. Sem hora
           nenhuma, o próprio vazio é o sinal.

           Vem pronto de `metadadosDoArquivo.js`, que conhece o post e a conta
           — este módulo não conhece nenhum dos dois. */
        ...(Array.isArray(options.metadados) ? options.metadados : []),
        ...bitstreamOpts,              // camada 2: remove SEI do bitstream H.264 pós-encode
        '-avoid_negative_ts', 'make_zero',
        '-max_muxing_queue_size', '9999',
        ...audioFilterOpts,
      ])
      .on('start', cmd => console.log(`   FFmpeg: ${cmd.slice(0, 120)}...`))
      .on('progress', p => {
        if (p.percent) process.stdout.write(`\r   Progresso: ${Math.floor(p.percent)}%  `);
      })
      .on('end', () => {
        console.log(`\n✅ Vídeo convertido [${cfg.description}]: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', err => {
        console.error(`\n💥 Erro na conversão: ${err.message}`);
        // Fallback: tenta com preset mais rápido se slow falhar
        if (cfg.preset === 'slow') {
          console.log('🔄 Tentando fallback com preset veryfast...');
          const fallbackPath = path.join(outputDir, `${filename}-reel-fallback.mp4`);
          comTrilha(cortaInicio(ffmpeg(inputPath)))
            .outputOptions([
              '-vf', scaleFilter,
              '-c:v', 'libx264',
              '-profile:v', 'high',
              '-level', '4.1',
              '-preset', 'veryfast',
              '-crf', '23',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-ar', '44100',
              '-ac', '2',
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p',
              ...metadataOpts,
              '-metadata:s:v:0', 'rotate=0',
              /* O fallback publica o mesmo vídeo por outro caminho — se ele
                 saísse sem o metadado da camada 3, uma falha de encode viraria
                 silenciosamente um arquivo sem hora de gravação. */
              ...(Array.isArray(options.metadados) ? options.metadados : []),
              ...bitstreamOpts,
              '-avoid_negative_ts', 'make_zero',
              '-max_muxing_queue_size', '9999',
              ...audioFilterOpts,
            ])
            .on('end', () => { console.log('✅ Fallback OK'); resolve(fallbackPath); })
            .on('error', e2 => reject(e2))
            .save(fallbackPath);
        } else {
          reject(err);
        }
      })
      .save(outputPath);
  });

  if (processMode === 'sem_limpeza') {
    _inProgress.set(outputPath, promise);
    promise.finally(() => _inProgress.delete(outputPath));
  }

  return promise;
}

/**
 * Imagem no formato que a API oficial aceita: JPEG, até 1440 px de largura e
 * proporção entre 4:5 e 1,91:1 no feed (9:16 no story).
 *
 * Imagem já dentro da proporção só é recodificada em JPEG — nada é cortado.
 * Fora dela, ganha borda preta até caber, em vez de o Instagram recusar.
 *
 * @param {'feed'|'story'} tipo
 * @returns {Promise<string>} caminho do JPEG em uploads/processed
 */
function jpegParaInstagram(inputPath, tipo = 'feed') {
  const outputDir = path.resolve(__dirname, '../../uploads/processed');
  ensureDir(outputDir);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${base}-ig-${tipo}.jpg`);

  const filtro = tipo === 'story'
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
    : "scale='min(1440,iw)':-2,"
      + "pad=w='max(iw,ceil(ih*0.8/2)*2)':h='max(ih,ceil(iw/1.91/2)*2)':x=(ow-iw)/2:y=(oh-ih)/2:color=black,"
      + "scale='min(1440,iw)':-2";

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', filtro, '-q:v', '2', '-frames:v', '1'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

module.exports = {
  convertToReelFormat,
  probeVideo,
  jpegParaInstagram,
  isVideo,
  isImage,
};
