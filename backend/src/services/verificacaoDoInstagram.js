'use strict';

/**
 * A verificação do Instagram ("confirme que você é humano") vista pela API.
 *
 * ── O que aconteceu
 *
 * Cinco contas novas, conectadas pela API oficial numa mesma noite, caíram
 * juntas como "Token inválido — reconecte" no primeiro sync depois de
 * conectar. O Instagram tinha respondido, para todas, o erro 190 com o texto
 * "You cannot access the app till you log in to www.instagram.com and follow
 * the instructions given". Isso NÃO é token expirado nem inválido: é a conta
 * em verificação. O token fica suspenso até a pessoa entrar no instagram.com
 * com aquela conta e passar pelo "confirme que você é humano" — e depois
 * volta a valer sozinho, sem reconectar nada.
 *
 * Classificar isso como "reconecte" mandava a pessoa fazer a coisa errada
 * (refazer o OAuth numa conta que só precisava de um clique no Instagram),
 * e a tentativa de renovar o token dentro do sync gastava uma chamada que ia
 * falhar com a mesma mensagem.
 *
 * ── Por que contas novas caem assim
 *
 * Conta recém-criada, sem publicação, virando Creator e autorizando um app de
 * terceiro minutos depois, várias da mesma máquina na mesma hora — é o perfil
 * que o risco do Instagram marca para verificação. Não há chamada nossa que
 * cause isso (o sync fala só com graph.instagram.com, autenticado pelo token
 * que a própria Meta emitiu); e não há chamada nossa que resolva. O que este
 * módulo faz é dizer a verdade e recuperar sozinho quando ela for resolvida.
 */

const PADROES_DE_VERIFICACAO = [
  /log in to www\.instagram\.com/i,
  /follow the instructions given/i,
  /checkpoint/i,
  /challenge_required/i,
  /confirm (that )?you('re| are) human/i,
];

/** A mensagem de erro da Graph descreve a conta em verificação? */
function ehVerificacaoPendente(mensagem) {
  const m = String(mensagem || '');
  return PADROES_DE_VERIFICACAO.some(re => re.test(m));
}

/** O que gravar em `lastError` — em português, dizendo o que fazer e o que esperar. */
const MENSAGEM_DE_VERIFICACAO =
  'Instagram pediu verificação nesta conta ("confirme que você é humano"). '
  + 'Entre em instagram.com com ela, conclua a verificação e aguarde: o token volta a valer sozinho (checado a cada 5 min).';

/** O `update` de saúde para o caso: restrita, com a instrução. */
function saudeDeVerificacao() {
  return { healthStatus: 'restrita', lastError: MENSAGEM_DE_VERIFICACAO };
}

module.exports = { ehVerificacaoPendente, saudeDeVerificacao, MENSAGEM_DE_VERIFICACAO, PADROES_DE_VERIFICACAO };
