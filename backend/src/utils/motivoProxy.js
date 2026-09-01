'use strict';

/**
 * O que o fornecedor de proxy diz, traduzido.
 *
 * ── Por que num módulo
 *
 * A mesma resposta aparece em dois caminhos que não se falam: o teste do
 * painel de Proxies, e a falha de login que sobe do serviço Python. Os dois
 * mostravam a mesma coisa de formas diferentes — o primeiro dizia "HTTP 407",
 * o segundo dizia "verifique se o proxy está ativo e funcionando".
 *
 * A segunda mensagem é pior que inútil: o proxy ESTAVA ativo e funcionando. A
 * credencial foi aceita; o que acabou foi a cota de tráfego do plano. Mandar
 * conferir se está ativo faz a pessoa reiniciar, testar, trocar senha — tudo
 * inútil, e nada disso chega perto da causa.
 *
 * Duas cópias desta tabela divergiriam na primeira vez que um código novo
 * aparecesse, e a divergência ficaria escondida no caminho menos usado.
 */

/* O que os fornecedores dizem, traduzido. A lista é curta de propósito: só
   entram códigos que eu VI acontecer, porque inventar tradução para código
   que nunca apareceu produz explicação convincente e errada. */
const _MOTIVOS = Object.freeze({
  /* Cada frase diz o que HOUVE e o que FAZER. Só o primeiro descreve e deixa
     a pessoa parada: "cota esgotada" é preciso e não ajuda ninguém às duas da
     manhã. Um teste exige o comprimento mínimo justamente para impedir que a
     próxima entrada volte a ser só descrição. */
  TRAFFIC_EXHAUSTED:
    'a cota de tráfego do plano acabou — renove ou compre mais no painel do fornecedor',
  QUOTA_EXCEEDED:
    'a cota do plano foi excedida — aumente o limite ou espere o próximo ciclo',
  SUBSCRIPTION_EXPIRED:
    'a assinatura do proxy venceu — renove no painel do fornecedor para voltar a usar',
  AUTH_FAILED:
    'usuário ou senha do proxy incorretos — confira a credencial no painel do fornecedor',
  INVALID_USER:
    'este usuário não existe no fornecedor — confira se a credencial é da conta certa',
  /* Visto em 01/09/2026, com PROXY_SESSAO_MOLDE ligado. O fornecedor não
     ignora o sufixo `;session.x` que acrescentávamos ao usuário: ele recusa a
     credencial INTEIRA e chama isso de NO_USER. Como o teste do painel usa a
     URL crua e passa, a leitura natural é culpar a conta — por isso a frase
     nomeia o molde antes de qualquer outra hipótese. */
  NO_USER:
    'o fornecedor não reconhece este usuário de proxy — se PROXY_SESSAO_MOLDE estiver preenchido, é o sufixo de sessão que ele recusa; deixe-o vazio e teste de novo',
  IP_NOT_ALLOWED:
    'este servidor não está na lista de IPs autorizados — adicione o IP dele no fornecedor',
});

function _traduzir(motivo) {
  const chave = Object.keys(_MOTIVOS).find(k => motivo.toUpperCase().includes(k));
  return chave ? _MOTIVOS[chave] : '';
}


module.exports = { MOTIVOS: _MOTIVOS, traduzir: _traduzir };
