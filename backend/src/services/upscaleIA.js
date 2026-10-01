'use strict';

/**
 * Upscale de FOTO com IA (Real-ESRGAN na CPU, via scripts/upscale_ia.py).
 *
 * Uma foto por vez no servidor inteiro: a rede usa todos os núcleos, e duas ao
 * mesmo tempo só deixariam as duas (e as publicações) mais lentas.
 * Vídeo não passa por aqui — quadro a quadro, um Reel levaria horas na CPU.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PYTHON = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.resolve(__dirname, '../../scripts/upscale_ia.py');
const MODELOS = ['rapida', 'maxima'];
const LIMITE_MS = { rapida: 10 * 60_000, maxima: 60 * 60_000 };

let _disponivel = null;
/** O Python e o pacote estão instalados? (verificado uma vez) */
function disponivel() {
  if (_disponivel === null) {
    const r = spawnSync(PYTHON, ['-c', 'import realesrgan_ncnn_py'], { timeout: 30_000, env: process.env });
    _disponivel = r.status === 0;
    if (!_disponivel) console.log('ℹ️ [IA] upscale com IA indisponível (instale realesrgan-ncnn-py)');
  }
  return _disponivel;
}

let fila = Promise.resolve();

/**
 * @param {string} origem   arquivo de imagem
 * @param {string} destino  .png de saída
 * @param {'rapida'|'maxima'} modelo
 * @param {string} alvo     menor lado em px, ou 'original'
 */
function melhorar(origem, destino, modelo, alvo) {
  if (!MODELOS.includes(modelo)) return Promise.reject(new Error('modelo de IA inválido'));
  if (!disponivel()) return Promise.reject(new Error('o upscale com IA não está instalado neste servidor'));
  const tarefa = fila.then(() => new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [SCRIPT, origem, destino, modelo, String(alvo)], { env: process.env });
    let saida = '';
    p.stdout.on('data', d => { saida += d; });
    p.stderr.on('data', d => { saida += d; });
    const relogio = setTimeout(() => p.kill('SIGKILL'), LIMITE_MS[modelo]);
    p.on('error', err => { clearTimeout(relogio); reject(err); });
    p.on('close', codigo => {
      clearTimeout(relogio);
      if (codigo === 0 && /ok \d+x\d+/.test(saida)) return resolve();
      console.log(`⚠️ [IA] upscale falhou (${codigo}): ${saida.slice(-400)}`);
      reject(new Error(codigo === null ? 'o upscale com IA passou do tempo limite' : 'o upscale com IA falhou'));
    });
  }));
  fila = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { disponivel, melhorar, MODELOS };
