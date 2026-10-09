'use strict';

/**
 * Registro de atividade — o que cada usuário fez no painel, com hora, IP e
 * aparelho. Responde "quem apagou esse envio?" e "alguém entrou na minha
 * conta?".
 *
 * Duas fontes:
 *  • `middleware`: toda requisição que MUDA algo (POST/PUT/PATCH/DELETE) e deu
 *    certo vira uma linha, descrita em português pela tabela ACOES. Rota nova
 *    entra sozinha (com a descrição genérica) — ninguém precisa lembrar.
 *  • `registrar()`: o que a rota sabe melhor que o caminho — login, login
 *    recusado, dois fatores ligado/desligado.
 *
 * Nunca guarda o corpo da requisição (pode ter senha, token, legenda inteira):
 * só a ação e os ids do caminho. Linhas com mais de 90 dias saem sozinhas.
 */

const { sql } = require('../db');

const RETENCAO_DIAS = 90;

/* [método, caminho, descrição]. A primeira que casa vence. */
const ACOES = [
  ['POST',   /^\/posts\/?$/,                          'Mandou publicar'],
  ['POST',   /^\/posts\/retry-errors$/,               'Tentou de novo os envios com erro'],
  ['POST',   /^\/posts\/fila\/limpar$/,               'Limpou a fila de envios'],
  ['PATCH',  /^\/posts\/[^/]+\/cancel$/,              'Cancelou um envio'],
  ['POST',   /^\/posts\/[^/]+\/retry$/,               'Tentou de novo um envio'],
  ['DELETE', /^\/posts\/[^/]+$/,                      'Apagou um envio'],
  ['DELETE', /^\/accounts\/[^/]+$/,                   'Removeu uma conta do Instagram'],
  ['POST',   /^\/accounts\/(sync-all|[^/]+\/sync)$/,  'Atualizou contas do Instagram'],
  ['POST',   /^\/media\/upload$/,                     'Enviou mídias para a biblioteca'],
  ['DELETE', /^\/media\//,                            'Apagou da biblioteca'],
  ['POST',   /^\/api\/stories\/?$/,                   'Publicou stories'],
  ['POST',   /^\/loops\/?$/,                          'Criou um loop'],
  ['POST',   /^\/loops\/[^/]+\/toggle$/,              'Ligou/desligou um loop'],
  ['DELETE', /^\/loops\/[^/]+$/,                      'Apagou um loop'],
  ['POST',   /^\/legends\/?$/,                        'Criou uma legenda'],
  ['DELETE', /^\/legends\/[^/]+$/,                    'Apagou uma legenda'],
  ['POST',   /^\/meta-apps\/?$/,                      'Cadastrou um app da Meta'],
  ['DELETE', /^\/meta-apps\/[^/]+$/,                  'Apagou um app da Meta'],
  ['POST',   /^\/funil\/config\/novo-token$/,         'Gerou um endereço novo do webhook'],
  ['POST',   /^\/funil\/links$/,                      'Criou um link rastreado'],
  ['DELETE', /^\/funil\/links\/[^/]+$/,               'Apagou um link rastreado'],
  ['PUT',    /^\/conta\/senha$/,                      'Trocou a senha'],
  ['POST',   /^\/conta\/logo$/,                       'Enviou um logo'],
  ['DELETE', /^\/conta\/logo$/,                       'Removeu o logo'],
  ['PUT',    /^\/conta\/?$/,                          'Alterou os dados da conta'],
  ['POST',   /^\/usuarios\/[^/]+\/aprovar$/,          'Aprovou um usuário'],
  ['POST',   /^\/usuarios\/[^/]+\/recusar$/,          'Recusou um usuário'],
  ['POST',   /^\/usuarios\/[^/]+\/bloquear$/,         'Bloqueou um usuário'],
  ['POST',   /^\/usuarios\/[^/]+\/reativar$/,         'Reativou um usuário'],
  ['POST',   /^\/usuarios\/[^/]+\/2fa\/desligar$/,    'Desligou o 2FA de um usuário'],
  ['DELETE', /^\/usuarios\/[^/]+$/,                   'Apagou um usuário'],
  ['POST',   /^\/ai\//,                               'Gerou legendas com IA'],
  ['POST',   /^\/preparos\/cancelar$/,                'Cancelou variações de mídia'],
  ['POST',   /^\/preparos\/biblioteca$/,              'Mandou variações para a Biblioteca'],
  ['DELETE', /^\/preparos\/?$/,                       'Excluiu variações de mídia'],
  ['POST',   /^\/preparos\/(arquivos|zip)$/,          null], // um por arquivo: barulho
  /* Barulho: marcar notificação como lida, prévias, sincronizações de métrica. */
  ['*',      /^\/(notificacoes|events|insights|analytics)\b/, null],
  ['*',      /^\/(auth|conta\/2fa)\b/,                null], // registrados pela própria rota
  ['*',      /^\/(posts|media|loops)\/(upload|generate-thumbs|upload-media)/, null],
];

const VERBO = { POST: 'Fez', PUT: 'Alterou', PATCH: 'Alterou', DELETE: 'Apagou' };

/** A descrição da ação, ou null quando não vale registrar. */
function descrever(metodo, caminho) {
  for (const [m, re, texto] of ACOES) {
    if ((m === '*' || m === metodo) && re.test(caminho)) return texto;
  }
  const area = caminho.split('/').filter(Boolean)[0] || '';
  return `${VERBO[metodo] || metodo} algo em ${area}`;
}

const aparelhoDe = req => String(req.headers?.['user-agent'] || '').slice(0, 200);
const ipDe = req => String(req.headers?.['cf-connecting-ip'] || req.ip || '').slice(0, 64);

let ultimaLimpeza = 0;
async function _limparAntigas() {
  if (Date.now() - ultimaLimpeza < 6 * 3_600_000) return;
  ultimaLimpeza = Date.now();
  await sql`delete from registro_de_atividade where quando < now() - make_interval(days => ${RETENCAO_DIAS})`;
}

async function registrar({ usuarioId = null, acao, detalhe = '', req = null }) {
  try {
    await sql`
      insert into registro_de_atividade (usuario_id, acao, detalhe, ip, aparelho)
      values (${usuarioId}, ${String(acao).slice(0, 200)}, ${String(detalhe).slice(0, 300)},
              ${req ? ipDe(req) : ''}, ${req ? aparelhoDe(req) : ''})`;
    _limparAntigas().catch(() => {});
  } catch (err) {
    // O registro nunca derruba a ação que ele está registrando.
    console.log(`⚠️  [Atividade] não registrou "${acao}": ${err.message}`);
  }
}

function middleware(req, res, next) {
  if (!VERBO[req.method]) return next();
  res.on('finish', () => {
    if (!req.user?.id || res.statusCode >= 400) return;
    const caminho = String(req.originalUrl || req.url).split('?')[0].replace(/^\/api(?=\/)(?!\/stories)/, '');
    const acao = descrever(req.method, caminho);
    if (acao) registrar({ usuarioId: req.user.id, acao, detalhe: `${req.method} ${caminho}`, req });
  });
  next();
}

async function listar({ usuarioId = null, limite = 100, antesDe = null } = {}) {
  const n = Math.min(Math.max(Number(limite) || 100, 1), 500);
  return sql`
    select r.id, r.quando, r.acao, r.detalhe, r.ip, r.aparelho, r.usuario_id,
           u.nome as usuario_nome, u.email as usuario_email, u.papel as usuario_papel
    from registro_de_atividade r left join usuarios u on u.id = r.usuario_id
    where true
      ${usuarioId ? sql`and r.usuario_id = ${usuarioId}` : sql``}
      ${antesDe ? sql`and r.id < ${antesDe}` : sql``}
    order by r.id desc
    limit ${n}`;
}

module.exports = { registrar, middleware, descrever, listar, RETENCAO_DIAS };
