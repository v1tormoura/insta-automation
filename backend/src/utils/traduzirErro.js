'use strict';

/**
 * Traduz mensagens de erro da API do Instagram (em inglês) para português.
 * Usado em todos os pontos que salvam lastError no banco.
 */
function traduzirErro(msg) {
  if (!msg) return 'Erro desconhecido';
  const m = String(msg);

  if (/session.*expired|token.*expired|expired.*token|has been logged out|user.*logged.*out/i.test(m))
    return 'Sessão expirada — reconecte via 🔗 API';
  if (/password.*changed|change.*password|password.*reset/i.test(m))
    return 'Senha alterada no Instagram — reconecte via 🔗 API';
  if (/token.*invalid|invalid.*token|invalid.*access|OAuthException|code 190|error 190/i.test(m))
    return 'Token inválido — reconecte via 🔗 API';
  if (/permission.*revoked|revoked.*permission|app.*not.*authorized/i.test(m))
    return 'Permissão revogada — reconecte via 🔗 API';
  if (/checkpoint|challenge.*required|IgCheckpoint/i.test(m))
    return 'Checkpoint pendente — verifique o app do Instagram';
  if (/feedback_required|action.*blocked|IgActionSpam/i.test(m))
    return 'Ação bloqueada pelo Instagram (possível spam)';
  if (/account.*disabled|disabled.*account|permanently disabled/i.test(m))
    return 'Conta desativada pelo Instagram';
  if (/account.*banned|banned.*account|violat.*terms/i.test(m))
    return 'Conta banida pelo Instagram';
  if (/performing too many actions|too many actions/i.test(m))
    return 'Limite de publicação de mídia excedido — aguarde 24h (máximo 25 posts/dia pela API)';
  if (/rate.*limit|too many request|please.*wait.*before/i.test(m))
    return 'Limite de requisições atingido — aguarde alguns minutos';
  if (/network|ECONNREFUSED|ETIMEDOUT|fetch failed|ENOTFOUND/i.test(m))
    return 'Erro de rede — verifique a conexão com a internet';
  if (/media.*not.*found|not.*found.*media/i.test(m))
    return 'Mídia não encontrada ou inválida';
  if (/video.*format|unsupported.*format|codec/i.test(m))
    return 'Formato de vídeo não suportado pelo Instagram';
  if (/container.*not.*ready|media.*not.*ready/i.test(m))
    return 'Vídeo ainda processando no Instagram — tente novamente';
  if (/caption.*too long|text.*too long/i.test(m))
    return 'Legenda muito longa — reduza o texto';

  return m.slice(0, 200);
}

module.exports = traduzirErro;
