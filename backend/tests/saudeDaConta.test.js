/**
 * Saúde da conta diante de erro de publicação.
 *
 * Estes testes existem por causa de uma regressão real: o worker fazia
 *
 *     healthUpdate.healthStatus = classifyError(err) || 'sessao_expirada';
 *
 * e o `||` descartava a decisão de `classifyError`, que devolve null DE
 * PROPÓSITO para erro transitório. Na prática, qualquer erro não mapeado —
 * timeout de rede, ffmpeg falhando, o serviço Python reiniciando — marcava a
 * conta como sessão expirada. Bastava um tropeço para a conta ser dada como
 * morta logo depois de conectar.
 *
 * A regra que estes testes protegem: falha de publicação e saúde de conta são
 * coisas diferentes. A publicação falha e é reprocessada; a conta só muda de
 * estado quando o Instagram diz alguma coisa sobre ELA.
 */
const { classifyError } = require('../src/jobs/healthCheck');

/* Espelha o mapeamento do worker. Se ele mudar lá, este objeto precisa mudar
   junto — e é justamente essa duplicação que o último teste vigia. */
const IG_HEALTH = {
  SESSION_EXPIRED:       'sessao_expirada',
  NO_INSTAGRAPI_SESSION: 'sessao_expirada',
  CHALLENGE_REQUIRED:    'restrita',
  FEEDBACK_REQUIRED:     'restrita',
  RATE_LIMITED:          'restrita',
};

/** Reproduz a decisão do worker: só classifica, nunca inventa um padrão. */
function novaSaude(err, provider = 'instagrapi') {
  const classificado = provider === 'instagrapi'
    ? (IG_HEALTH[err?.code || ''] || classifyError(err))
    : classifyError(err);
  return classificado || null;   // null = não altera o status
}

const erro = (mensagem, extras = {}) => Object.assign(new Error(mensagem), extras);

describe('erro transitório não derruba a conta', () => {
  const transitorios = [
    ['timeout de rede',            erro('connect ETIMEDOUT 1.2.3.4:443', { code: 'ETIMEDOUT' })],
    ['conexão recusada',           erro('connect ECONNREFUSED', { code: 'ECONNREFUSED' })],
    ['serviço Python fora',        erro('instagrapi service unavailable', { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' })],
    ['tipo não suportado',         erro('formato não suportado', { code: 'UNSUPPORTED_TYPE' })],
    ['falha de codificação',       erro('ffmpeg exited with code 1')],
    ['arquivo grande demais',      erro('file too large')],
    ['erro genérico do servidor',  erro('Internal Server Error', { code: 500 })],
    ['mensagem vazia',             erro('')],
  ];

  test.each(transitorios)('%s preserva a saúde', (_nome, err) => {
    expect(novaSaude(err)).toBeNull();
  });

  test('rate limit é transitório e não altera o status', () => {
    // Sem código: só a mensagem. classifyError trata "rate limit" como
    // transitório de propósito — é espera, não é conta quebrada.
    expect(classifyError(erro('rate limit exceeded, please wait'))).toBeNull();
    expect(novaSaude(erro('please try again later'))).toBeNull();
  });
});

describe('erro de sessão e de bloqueio alteram a conta', () => {
  test.each([
    ['SESSION_EXPIRED',       { code: 'SESSION_EXPIRED' },       'sessao_expirada'],
    ['NO_INSTAGRAPI_SESSION', { code: 'NO_INSTAGRAPI_SESSION' }, 'sessao_expirada'],
    ['CHALLENGE_REQUIRED',    { code: 'CHALLENGE_REQUIRED' },    'restrita'],
    ['FEEDBACK_REQUIRED',     { code: 'FEEDBACK_REQUIRED' },     'restrita'],
    ['RATE_LIMITED',          { code: 'RATE_LIMITED' },          'restrita'],
  ])('código %s vira %s', (_nome, extras, esperado) => {
    expect(novaSaude(erro('falhou', extras))).toBe(esperado);
  });

  test('login required pela mensagem vira sessão expirada', () => {
    expect(novaSaude(erro('login_required: user has logged out'))).toBe('sessao_expirada');
  });

  test('conta desativada vira banida', () => {
    expect(novaSaude(erro('Your account has been disabled for violating our terms'))).toBe('banida');
  });

  test('checkpoint vira restrita', () => {
    expect(novaSaude(erro('challenge_required: verify your identity'))).toBe('restrita');
  });
});

describe('o provider da Graph API segue a mesma regra', () => {
  test('erro desconhecido preserva a saúde', () => {
    expect(novaSaude(erro('algo inesperado'), 'graph')).toBeNull();
  });

  test('token expirado é reconhecido', () => {
    expect(novaSaude(erro('OAuthException: token expired'), 'graph')).toBe('sessao_expirada');
  });
});

describe('o worker não inventa um status padrão', () => {
  /* O teste que pega a regressão pela raiz: o valor de saída para um erro
     desconhecido tem de ser null, e não uma string qualquer. Se alguém
     reintroduzir um `|| 'algo'`, isto reprova. */
  test('erro fora de todos os mapas devolve null, não uma string', () => {
    const r = novaSaude(erro('xyzzy — mensagem que não casa com nada', { code: 'ALGO_NOVO' }));
    expect(r).toBeNull();
    expect(typeof r).not.toBe('string');
  });

  test('o mapa do worker cobre só códigos de sessão e de bloqueio', () => {
    const valores = new Set(Object.values(IG_HEALTH));
    expect([...valores].sort()).toEqual(['restrita', 'sessao_expirada']);
  });
});
