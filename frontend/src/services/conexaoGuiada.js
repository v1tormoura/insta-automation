/**
 * O link guiado e o que ele carrega.
 *
 * ── Por que existe uma página guiada
 *
 * Enquanto o app da Meta está em desenvolvimento, só conta com papel de
 * TESTADOR consegue autorizá-lo. O link de autorização cru cai direto no
 * Instagram, e ali a conta que não é testadora recebe um erro que não diz o que
 * faltou — a pessoa fica tentando de novo sem saber que o passo que falta é
 * aceitar um convite.
 *
 * O link guiado aponta para uma página nossa que mostra os dois passos na ordem
 * certa. É o que transforma um erro sem explicação numa instrução.
 *
 * ── Por que num módulo, e não dentro do componente
 *
 * Duas razões. A do lint: exportar função de um arquivo de componente quebra o
 * fast refresh do Vite. A que importa: o que este arquivo decide — o que pode
 * virar `state` de OAuth, e como o link é montado — é verificável sozinho, e
 * dentro de um componente não seria.
 */

/**
 * Só o que pode virar `state` de OAuth com segurança.
 *
 * O valor vai numa requisição e volta assinado pelo servidor. Recusar o que não
 * é 'new' nem um ObjectId evita levar texto de fora até lá; e um id inventado
 * falharia no callback de um jeito que ninguém ligaria ao endereço colado.
 *
 * Cai em 'new' em vez de lançar: uma conta nova é o caso mais comum e o mais
 * inofensivo — no pior caso a pessoa conecta uma conta a mais, em vez de a tela
 * não abrir.
 */
export function contaValida(valor) {
  const v = String(valor ?? '').trim();
  if (v === 'new' || v === '') return 'new';
  return /^[0-9a-f]{24}$/i.test(v) ? v : 'new';
}

/**
 * O endereço da página guiada.
 *
 * `origem` vem de `window.location.origin` e não de variável de ambiente: o
 * link tem de apontar para o mesmo endereço por onde a tela está sendo
 * acessada. Com uma variável, um build de produção servido de outro domínio
 * mandaria a pessoa para localhost.
 *
 * @param {string} origem — normalmente `window.location.origin`
 * @param {string} [conta] — id da conta a reconectar, ou 'new'
 * @param {string} [metaAppId]
 */
export function montarLinkGuiado(origem, conta = 'new', metaAppId = '') {
  const p = new URLSearchParams({ conta: contaValida(conta) });
  /* Só entra se houver App escolhido: `app=` vazio na URL não significa nada e
     ainda faria o servidor procurar um MetaApp de id vazio. */
  const app = String(metaAppId ?? '').trim();
  if (app) p.set('app', app);
  return `${String(origem ?? '').replace(/\/$/, '')}/conectar?${p.toString()}`;
}
