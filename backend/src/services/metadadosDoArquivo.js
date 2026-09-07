'use strict';

/**
 * O metadado do arquivo de cada publicação.
 *
 * ── O que havia antes, e por que não bastava
 *
 * O pipeline limpava tudo: `-map_metadata -1`, `-map_metadata:s -1`,
 * `-map_chapters -1`, `+bitexact` e remoção dos NAL units SEI. Isso resolve
 * metade do problema — nenhum traço da origem sobrevive, e isso é essencial.
 *
 * A outra metade é que o resultado ficava com metadado NENHUM. Medido:
 * `creation_time` ausente, e `handler_name` com os nomes do ffmpeg
 * (`VideoHandler` / `SoundHandler`). Vídeo saído de celular não é assim — o
 * MediaMuxer do Android grava a hora da gravação e usa `VideoHandle` e
 * `SoundHandle`, sem o "r". Um arquivo sem hora nenhuma é, ele mesmo, um
 * sinal: diz que passou por processamento.
 *
 * Então este módulo não limpa nada. Ele escreve, DEPOIS da limpeza, um
 * metadado plausível e diferente em cada publicação.
 *
 * ── Por que a hora não vem do relógio
 *
 * `prepararParaConta` promete que a mesma conta reprocessando o mesmo post
 * recebe o MESMO arquivo. É o que evita, numa falha entre o upload e o
 * registro, a conta terminar com dois reels quase idênticos.
 *
 * Uma hora tirada de `Date.now()` quebraria essa promessa: a segunda tentativa
 * gravaria outra hora e produziria outro arquivo. Aqui ela sai do INSTANTE DO
 * POST — que o ObjectId do Mongo já carrega — menos um deslocamento semeado
 * pelo par (post, conta). Fixo para sempre, e diferente em cada par.
 *
 * ── O que este módulo NÃO consegue remover
 *
 * `encoder: Lavc libx264` no stream de vídeo. Medido em quatro tentativas:
 * `-metadata:s:v:0 encoder=`, com valor, e `-map_metadata:s:v:0 -1` — o muxer
 * mov escreve essa tag a partir do contexto do codec, depois dos metadados do
 * usuário, e ela sobrevive a todas. Sair dela exigiria reescrever as boxes do
 * mp4 depois do encode, o que é risco de arquivo corrompido por um ganho que
 * não justifica. Ela já estava lá antes deste módulo; nada piorou.
 */

const crypto = require('crypto');

/* De quanto tempo antes do post a "gravação" pode ter sido feita.
   Meia hora a oito horas: alguém que gravou de manhã e postou à tarde. Zero
   seria implausível (ninguém publica no mesmo segundo em que para de gravar) e
   dias atrás não muda nada em termos de sinal, só afasta da verossimilhança. */
const ATRASO_MIN_MS = 30 * 60 * 1000;
const ATRASO_MAX_MS = 8 * 60 * 60 * 1000;

/* Os nomes que o MediaMuxer do Android grava. Sem o "r" final, ao contrário
   dos do ffmpeg — é a diferença entre um arquivo que diz "saí de um celular" e
   um que diz "saí de uma ferramenta". */
const HANDLER_VIDEO = 'VideoHandle';
const HANDLER_AUDIO = 'SoundHandle';

/** Número estável em [0, 1) a partir de uma chave. */
function fracaoDe(chave) {
  const d = crypto.createHash('sha256').update(String(chave)).digest();
  return d.readUInt32BE(0) / 4294967296;
}

/**
 * O instante em que este post existe, sem depender do relógio.
 *
 * O ObjectId do Mongo carrega o segundo da criação nos primeiros 4 bytes, e é
 * daí que sai — o documento não muda, então o valor é o mesmo em toda
 * reexecução. `createdAt` serve igual quando existe.
 *
 * Sem nenhum dos dois (post sintético, teste), cai no relógio. Aí a
 * reprodutibilidade se perde, e é melhor que falhar: um arquivo com hora
 * plausível vale mais que nenhum arquivo.
 */
function instanteDoPost(post) {
  const id = post?._id;
  if (id && typeof id.getTimestamp === 'function') {
    try {
      const t = id.getTimestamp();
      if (t instanceof Date && Number.isFinite(t.getTime())) return t.getTime();
    } catch { /* ObjectId de outra biblioteca; tenta os próximos */ }
  }
  /* ObjectId como string de 24 hex: os 8 primeiros são o segundo em hexa. */
  const comoTexto = String(id ?? '');
  if (/^[0-9a-f]{24}$/i.test(comoTexto)) {
    const seg = parseInt(comoTexto.slice(0, 8), 16);
    if (Number.isFinite(seg) && seg > 0) return seg * 1000;
  }
  const criado = post?.createdAt ? new Date(post.createdAt).getTime() : NaN;
  if (Number.isFinite(criado)) return criado;
  return Date.now();
}

/**
 * A hora no formato que o ffmpeg aceita em `creation_time`.
 *
 * Sempre em UTC com `Z` e microssegundos, que é a forma que o mp4 guarda. Uma
 * hora local aqui seria gravada como se fosse UTC e o arquivo diria que foi
 * gravado três horas depois do que foi.
 */
function comoCreationTime(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
}

/**
 * Os argumentos de metadado desta publicação.
 *
 * Vêm DEPOIS da limpeza na linha de comando, senão `-map_metadata -1` apagaria
 * o que este módulo escreve. Quem monta a linha garante a ordem.
 *
 * @param {object} post — precisa de `_id` (ou `createdAt`)
 * @param {object} account — precisa de `_id`
 * @returns {string[]} argumentos para o ffmpeg
 */
function argumentosDeMetadado(post, account) {
  const chave = `${post?._id ?? ''}:${account?._id ?? ''}`;
  const faixa = ATRASO_MAX_MS - ATRASO_MIN_MS;
  const atraso = ATRASO_MIN_MS + Math.floor(fracaoDe(chave) * faixa);
  const quando = comoCreationTime(instanteDoPost(post) - atraso);

  return [
    /* Global e por stream: o mp4 guarda a hora nos dois lugares, e um celular
       preenche os dois. Só o global deixaria os streams sem hora — que é
       justamente a incoerência que se está tentando evitar. */
    '-metadata', `creation_time=${quando}`,
    '-metadata:s:v:0', `creation_time=${quando}`,
    '-metadata:s:a:0', `creation_time=${quando}`,
    '-metadata:s:v:0', `handler_name=${HANDLER_VIDEO}`,
    '-metadata:s:a:0', `handler_name=${HANDLER_AUDIO}`,
  ];
}

module.exports = {
  argumentosDeMetadado, instanteDoPost, comoCreationTime, fracaoDe,
  ATRASO_MIN_MS, ATRASO_MAX_MS, HANDLER_VIDEO, HANDLER_AUDIO,
};
