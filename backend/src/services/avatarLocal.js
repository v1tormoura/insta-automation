'use strict';

/**
 * A foto de perfil, guardada localmente.
 *
 * ── Por que não guardar a URL do Instagram
 *
 * As URLs do CDN da Meta são assinadas e expiram em algumas horas. Guardar a
 * URL faz o avatar aparecer no dia em que a conta foi conectada e sumir depois,
 * sem nada nos logs — a imagem simplesmente para de carregar no navegador de
 * quem olha. Por isso o arquivo é baixado e servido por `/uploads`.
 *
 * ── Por que a versão na URL
 *
 * O arquivo tem nome fixo (`<username>.jpg`), então trocar a foto reescreve o
 * MESMO caminho. Para o React, `src` não mudou: ele não repinta, e o navegador
 * serve o que já tem em memória. A pessoa troca a foto, o backend grava certo,
 * e a tela continua mostrando a antiga — que foi exatamente o que aconteceu.
 *
 * `?v=<timestamp>` resolve os dois lados de uma vez: o valor no banco muda, o
 * React vê um `src` diferente e repinta, e o navegador trata como outro
 * recurso. Não é cache-busting decorativo — é o que faz a troca aparecer.
 *
 * ── Por que num módulo só
 *
 * Esta função existia duplicada em `accountFastSync` (com retry) e em
 * `syncAccountInfo` (sem). Duas cópias da mesma ideia é como uma ganha a
 * versão na URL e a outra não, e o avatar volta a não atualizar em metade dos
 * caminhos.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');

function garantirPasta() {
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

/**
 * O caminho público, com a versão que força o repintar.
 *
 * Exportada porque quem grava o arquivo por outro caminho (o serviço de edição
 * grava o buffer que acabou de enviar ao Instagram) precisa do mesmo formato —
 * e um formato montado à mão em dois lugares é um que diverge.
 */
function caminhoPublico(username, quando = Date.now()) {
  return `/uploads/avatars/${username}.jpg?v=${quando}`;
}

/**
 * Grava um buffer já em memória como avatar da conta.
 *
 * É o caso da edição de perfil: a foto que foi enviada ao Instagram é a mesma
 * que deve aparecer no painel, e baixá-la de volta do CDN seria pedir de volta
 * o que já se tem — além de depender de o Instagram já ter processado a troca,
 * o que leva alguns segundos e às vezes devolve a foto antiga.
 *
 * @returns {string} caminho público versionado, ou '' se não deu para gravar.
 */
function gravarAvatar(buffer, username) {
  if (!buffer || !buffer.length || !username) return '';
  try {
    garantirPasta();
    fs.writeFileSync(path.join(AVATARS_DIR, `${username}.jpg`), buffer);
    return caminhoPublico(username);
  } catch (err) {
    console.log(`⚠️ [Avatar] Não deu para gravar @${username}: ${err.message}`);
    return '';
  }
}

/**
 * Baixa o avatar do CDN e grava localmente.
 *
 * Com retry porque o CDN da Meta recusa pedidos esporadicamente e uma falha
 * isolada não é motivo para a conta ficar sem foto até o próximo ciclo — que
 * são 5 minutos.
 *
 * Nunca lança: um avatar que não baixou não pode derrubar a sincronização de
 * seguidores e publicações, que é o que realmente importa no ciclo.
 *
 * @returns {Promise<string>} caminho público versionado, ou '' se falhou.
 */
async function baixarAvatar(url, username, tentativas = 3) {
  if (!url || !username) return '';
  garantirPasta();
  const destino = path.join(AVATARS_DIR, `${username}.jpg`);

  for (let n = 1; n <= tentativas; n++) {
    try {
      await new Promise((resolve, reject) => {
        /* Grava num temporário e só depois renomeia. Escrevendo direto no
           destino, uma falha no meio deixa o arquivo pela metade — e o
           navegador mostra meia foto, que é pior do que mostrar a anterior. */
        const parcial = `${destino}.parcial`;
        const arquivo = fs.createWriteStream(parcial);
        const req = https.get(url, res => {
          if (res.statusCode !== 200) {
            arquivo.close();
            try { fs.unlinkSync(parcial); } catch { /* já não existe */ }
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.pipe(arquivo);
          arquivo.on('finish', () => {
            arquivo.close(() => {
              try {
                fs.renameSync(parcial, destino);
                resolve();
              } catch (err) { reject(err); }
            });
          });
          arquivo.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      });
      return caminhoPublico(username);
    } catch (err) {
      if (n < tentativas) {
        await new Promise(r => setTimeout(r, 1000 * n));
      } else {
        console.log(`⚠️ [Avatar] @${username}: falha após ${tentativas} tentativas — ${err.message}`);
        try { fs.unlinkSync(`${destino}.parcial`); } catch { /* já não existe */ }
        return '';
      }
    }
  }
  return '';
}

/**
 * A URL do CDN, reduzida ao que identifica a foto.
 *
 * O Instagram assina cada URL de avatar com um token que muda a cada resposta:
 * duas leituras da MESMA foto devolvem URLs diferentes. Comparar as URLs
 * inteiras diria "mudou" sempre.
 *
 * O caminho, esse é estável — muda quando a imagem muda, porque o Instagram
 * publica a nova com outro identificador. É ele que serve de assinatura.
 */
function origemDaFoto(url) {
  if (!url) return '';
  try { return new URL(url).pathname; } catch { return String(url); }
}

/**
 * A foto mudou desde a última vez?
 *
 * Sem esta comparação, toda passagem do sync gravaria um `?v=` novo: o React
 * repintaria todos os avatares e o navegador rebaixaria todas as imagens, de
 * cinco em cinco minutos, para mostrar exatamente o que já estava na tela.
 *
 * @param {string} urlNova   URL vinda do Instagram agora.
 * @param {string} origem    `account.avatarOrigem` — o caminho da vez passada.
 * @param {string} avatar    `account.avatar` — para detectar conta sem foto.
 */
function fotoMudou(urlNova, origem, avatar) {
  if (!urlNova) return false;
  // Sem avatar local, baixa mesmo que a origem bata: o arquivo pode ter sido
  // apagado do disco enquanto o campo continuou preenchido.
  if (!avatar) return true;
  return origemDaFoto(urlNova) !== (origem || '');
}

module.exports = {
  baixarAvatar, gravarAvatar, caminhoPublico,
  fotoMudou, origemDaFoto, AVATARS_DIR,
};
