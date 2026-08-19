'use strict';

/**
 * PublicationPlanner — monta a sequência de publicações antes de qualquer
 * execução.
 *
 * Módulo PURO por contrato: não toca MongoDB, Redis, BullMQ nem rede, e não lê
 * o relógio. O instante inicial chega por parâmetro (`startAt`). Toda a
 * aleatoriedade vem de um PRNG semeado — `Math.random` não é usado em lugar
 * nenhum. Isso torna o plano reproduzível: mesma entrada e mesma seed produzem
 * exatamente a mesma saída, o que permite auditar e depurar uma campanha.
 *
 * Entrada e saída são objetos simples. O planner não conhece Mongoose: quem
 * chama converte documentos em `{ id, ... }`, e a fase 4 converte o plano em
 * CampaignPublication.
 *
 * Usado por Campanha agora e, nas fases 10 e 11, também por Postar e Loop —
 * daí ser um serviço compartilhado e não parte do controller de campanha.
 */

class PlannerError extends Error {
  constructor(message, code = 'PLANNER_INVALID_INPUT') {
    super(message);
    this.name = 'PlannerError';
    this.code = code;
  }
}

/* ── PRNG determinístico ───────────────────────────────────────────────────── */

/** xmur3 — transforma a seed em texto num inteiro de 32 bits bem distribuído. */
function _hashSeed(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — gerador rápido e estável; devolve float em [0, 1). */
function _mulberry32(estado) {
  let a = estado >>> 0;
  return function proximo() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _criarRandom(seed) {
  // Seed ausente vira string vazia — continua determinístico, só não é único
  // por campanha. A fase 4 deve gravar uma seed real na criação.
  return _mulberry32(_hashSeed(String(seed == null ? '' : seed)));
}

/** Fisher–Yates com PRNG semeado — embaralhamento reproduzível. */
function _embaralhar(lista, rand) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Inteiro em [min, max] a partir do PRNG. */
function _inteiroEntre(min, max, rand) {
  if (max <= min) return min;
  return min + Math.floor(rand() * (max - min + 1));
}

/* ── Leitura tolerante de mapas ────────────────────────────────────────────── */

/**
 * Lê uma chave de estrutura que pode ser Map (vindo do Mongoose) ou objeto
 * simples (vindo de teste ou de payload HTTP).
 */
function _leMapa(fonte, chave) {
  if (!fonte || chave == null) return undefined;
  if (typeof fonte.get === 'function') return fonte.get(chave);
  return fonte[chave];
}

/* ── Normalização de entrada ───────────────────────────────────────────────── */

const _DIAS = {
  sunday: 0, domingo: 0,
  monday: 1, segunda: 1,
  tuesday: 2, terca: 2, terça: 2,
  wednesday: 3, quarta: 3,
  thursday: 4, quinta: 4,
  friday: 5, sexta: 5,
  saturday: 6, sabado: 6, sábado: 6,
};

/** Aceita [0..6] ou nomes ("monday", "segunda"). Devolve Set de números. */
function _normalizarDias(weekdays) {
  if (!Array.isArray(weekdays) || !weekdays.length) return null; // null = todos
  const dias = new Set();
  for (const d of weekdays) {
    if (typeof d === 'number' && d >= 0 && d <= 6) { dias.add(d); continue; }
    const n = _DIAS[String(d).trim().toLowerCase()];
    if (n !== undefined) dias.add(n);
  }
  return dias.size ? dias : null;
}

/** "HH:MM" → minutos desde a meia-noite. Devolve null se ausente/ inválido. */
function _minutosDoHorario(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Aceita tanto os nomes do model Campaign (intervalMinMinutes) quanto os curtos
 * (intervalMin), porque o planner também servirá Postar e Loop, que têm outro
 * vocabulário.
 */
function _normalizarSchedule(schedule = {}) {
  const intervalMin = Number(
    schedule.intervalMin ?? schedule.intervalMinMinutes ?? 0
  );
  const intervalMax = Number(
    schedule.intervalMax ?? schedule.intervalMaxMinutes ?? intervalMin
  );

  const inicioJanela = _minutosDoHorario(schedule.windowStart);
  const fimJanela    = _minutosDoHorario(schedule.windowEnd);

  if (inicioJanela !== null && fimJanela !== null && fimJanela <= inicioJanela) {
    throw new PlannerError(
      'Janela de horário inválida: o fim precisa ser depois do início (janela que cruza a meia-noite não é suportada).',
      'PLANNER_INVALID_WINDOW'
    );
  }

  if (intervalMin < 0 || intervalMax < 0) {
    throw new PlannerError('Intervalos não podem ser negativos.', 'PLANNER_INVALID_INTERVAL');
  }
  if (intervalMax < intervalMin) {
    throw new PlannerError(
      'Intervalo máximo não pode ser menor que o mínimo.',
      'PLANNER_INVALID_INTERVAL'
    );
  }

  return {
    intervalMin,
    intervalMax,
    useFixedInterval: !!schedule.useFixedInterval,
    inicioJanela,
    fimJanela,
    dias: _normalizarDias(schedule.weekdays),
  };
}

/* ── Janela de horário e dias permitidos ───────────────────────────────────── */

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Empurra a data para o próximo instante que respeita janela e dias da semana.
 *
 * Fora da janela ou em dia não permitido, avança para o início da janela do
 * próximo dia válido — nunca "encolhe" o intervalo para caber à força.
 */
function _proximoInstanteValido(data, cfg) {
  if (cfg.inicioJanela === null && !cfg.dias) return data;

  let d = new Date(data.getTime());

  // 366 iterações cobrem qualquer combinação de dias permitidos sem risco de
  // laço infinito caso a configuração seja impossível.
  for (let i = 0; i < 366; i++) {
    const diaOk = !cfg.dias || cfg.dias.has(d.getDay());

    if (!diaOk) {
      d = new Date(d.getTime() + UM_DIA_MS);
      d.setHours(0, 0, 0, 0);
      continue;
    }

    if (cfg.inicioJanela === null) return d;

    const minutos = d.getHours() * 60 + d.getMinutes();

    if (minutos < cfg.inicioJanela) {
      d.setHours(Math.floor(cfg.inicioJanela / 60), cfg.inicioJanela % 60, 0, 0);
      return d;
    }
    if (cfg.fimJanela !== null && minutos > cfg.fimJanela) {
      d = new Date(d.getTime() + UM_DIA_MS);
      d.setHours(Math.floor(cfg.inicioJanela / 60), cfg.inicioJanela % 60, 0, 0);
      continue;
    }
    return d;
  }

  throw new PlannerError(
    'Não foi possível encontrar horário válido — verifique janela e dias da semana.',
    'PLANNER_NO_VALID_SLOT'
  );
}

/* ── Montagem dos pares conta × conteúdo ───────────────────────────────────── */

/**
 * Quantas publicações a conta ainda pode receber (camada 1 do limite diário).
 *
 * A camada 2 continua sendo o checkDailyLimit da execução: esta aqui evita
 * gerar um plano impossível, aquela protege contra concorrência, campanhas
 * simultâneas e mudanças de limite entre o planejamento e a publicação.
 */
function _vagasDaConta(conta, totalConteudos, settings) {
  let vagas = totalConteudos;

  const maxPorConta = settings?.coverage?.maxContentsPerAccount;
  if (settings?.coverage?.mode === 'max_per_account' && Number(maxPorConta) > 0) {
    vagas = Math.min(vagas, Number(maxPorConta));
  }

  if (settings?.respectDailyLimit !== false) {
    const limite = Number(conta.dailyLimit ?? conta.dailyPostLimit ?? Infinity);
    if (Number.isFinite(limite)) {
      const publicadosHoje = Number(conta.postsToday || 0);
      vagas = Math.min(vagas, Math.max(0, limite - publicadosHoje));
    }
  }

  return vagas;
}

/**
 * Pares conta × conteúdo, já respeitando cobertura e limite diário.
 *
 * Quando uma conta recebe menos conteúdos que o total, o recorte começa em um
 * deslocamento diferente por conta. Sem isso, contas limitadas receberiam
 * sempre os primeiros conteúdos da lista e os últimos nunca seriam publicados.
 */
function _montarPares(accounts, contents, settings) {
  const pares = [];

  accounts.forEach((conta, indiceConta) => {
    const vagas = _vagasDaConta(conta, contents.length, settings);
    if (vagas <= 0) return;

    const deslocamento = contents.length ? indiceConta % contents.length : 0;
    for (let i = 0; i < vagas; i++) {
      const conteudo = contents[(deslocamento + i) % contents.length];
      pares.push({ accountId: conta.id, contentId: conteudo.id });
    }
  });

  return pares;
}

/* ── Estratégias de ordenação ──────────────────────────────────────────────── */

/**
 * Reordena para não repetir a mesma conta em publicações consecutivas.
 *
 * A cada passo escolhe a conta com MAIS itens restantes entre as diferentes da
 * anterior. Escolher simplesmente "a primeira diferente" se encurrala: sobram
 * todos os itens de uma mesma conta no fim, forçando repetições que eram
 * evitáveis. Priorizar quem tem mais pendências é a estratégia gulosa clássica
 * de reorganização e produz zero repetições sempre que existe arranjo válido.
 *
 * A ordem prévia (embaralhada pela seed) é preservada como critério de desempate,
 * então o resultado continua determinístico.
 */
function _espacarContas(pares) {
  const porConta = new Map();
  for (const p of pares) {
    if (!porConta.has(p.accountId)) porConta.set(p.accountId, []);
    porConta.get(p.accountId).push(p);
  }

  const saida = [];
  let anterior = null;

  while (saida.length < pares.length) {
    let melhor = null;
    let maiorRestante = 0;

    // Map preserva a ordem de inserção — o desempate segue a ordem embaralhada.
    for (const [contaId, fila] of porConta) {
      if (!fila.length || contaId === anterior) continue;
      if (fila.length > maiorRestante) {
        maiorRestante = fila.length;
        melhor = contaId;
      }
    }

    // Só resta a conta anterior: aceita a repetição em vez de travar.
    if (melhor === null) {
      melhor = [...porConta.keys()].find(id => porConta.get(id).length);
    }

    saida.push(porConta.get(melhor).shift());
    anterior = melhor;
  }

  return saida;
}

const ESTRATEGIAS = {
  /** Ordem literal das listas, agrupada por conta: A1 A2 A3 B1 B2 B3. */
  sequential(pares) {
    return pares;
  },

  /**
   * Mantém o agrupamento por conta, mas a ordem das contas e dos conteúdos
   * dentro de cada conta vem da seed — termina uma conta antes de ir à próxima,
   * sem que a sequência seja sempre a mesma.
   */
  account_first(pares, rand) {
    const porConta = new Map();
    for (const p of pares) {
      if (!porConta.has(p.accountId)) porConta.set(p.accountId, []);
      porConta.get(p.accountId).push(p);
    }
    const contas = _embaralhar([...porConta.keys()], rand);
    return contas.flatMap(id => _embaralhar(porConta.get(id), rand));
  },

  /**
   * Alterna as contas a cada publicação: leva o primeiro item de cada conta,
   * depois o segundo, e assim por diante. Distribui a carga no tempo sem
   * depender de aleatoriedade.
   */
  round_robin(pares) {
    const porConta = new Map();
    for (const p of pares) {
      if (!porConta.has(p.accountId)) porConta.set(p.accountId, []);
      porConta.get(p.accountId).push(p);
    }
    const filas = [...porConta.values()];
    const saida = [];
    const maior = Math.max(0, ...filas.map(f => f.length));
    for (let i = 0; i < maior; i++) {
      for (const fila of filas) {
        if (i < fila.length) saida.push(fila[i]);
      }
    }
    return saida;
  },

  /**
   * Embaralha todos os pares com a seed e depois espaça as contas, evitando
   * que a mesma conta publique duas vezes seguidas quando há alternativa.
   */
  interleaved_random(pares, rand) {
    return _espacarContas(_embaralhar(pares, rand));
  },
};

// 'manual' preserva a ordem recebida — a ordenação é responsabilidade de quem
// montou a lista (ex.: arrastar e soltar na interface).
ESTRATEGIAS.manual = ESTRATEGIAS.sequential;

/* ── Seleção de legenda e comentário ───────────────────────────────────────── */

/**
 * Escolhe o template segundo a prioridade
 * byAccountContent → byAccount → byContent → global.
 *
 * Devolve o texto BRUTO, com as variáveis intactas: a resolução acontece na
 * execução, pelo templateResolver, para que o mesmo template sirva a várias
 * publicações.
 */
function _escolherTemplate(fonte, accountId, contentId) {
  if (!fonte) return '';

  const composta = `${accountId}__${contentId}`;
  const candidatos = [
    _leMapa(fonte.byAccountContent, composta),
    _leMapa(fonte.byAccount, accountId),
    _leMapa(fonte.byContent, contentId),
    fonte.global,
  ];

  for (const valor of candidatos) {
    if (typeof valor === 'string' && valor.length) return valor;
  }
  return '';
}

/* ── Validação ─────────────────────────────────────────────────────────────── */

function _validarEntrada(accounts, contents, startAt) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new PlannerError('Selecione ao menos uma conta.', 'PLANNER_NO_ACCOUNTS');
  }
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new PlannerError('Selecione ao menos um conteúdo.', 'PLANNER_NO_CONTENTS');
  }

  const semIdConta = accounts.findIndex(a => !a || a.id == null || a.id === '');
  if (semIdConta !== -1) {
    throw new PlannerError(`Conta na posição ${semIdConta} está sem id.`, 'PLANNER_INVALID_ACCOUNT');
  }
  const semIdConteudo = contents.findIndex(c => !c || c.id == null || c.id === '');
  if (semIdConteudo !== -1) {
    throw new PlannerError(
      `Conteúdo na posição ${semIdConteudo} está sem id — conteúdo inexistente ou removido.`,
      'PLANNER_INVALID_CONTENT'
    );
  }

  const idsContas = accounts.map(a => String(a.id));
  if (new Set(idsContas).size !== idsContas.length) {
    throw new PlannerError('Há contas repetidas na seleção.', 'PLANNER_DUPLICATE_ACCOUNT');
  }
  const idsConteudos = contents.map(c => String(c.id));
  if (new Set(idsConteudos).size !== idsConteudos.length) {
    throw new PlannerError('Há conteúdos repetidos na seleção.', 'PLANNER_DUPLICATE_CONTENT');
  }

  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new PlannerError(
      'startAt é obrigatório e precisa ser uma data válida — o planner não lê o relógio.',
      'PLANNER_INVALID_START'
    );
  }
}

/* ── API pública ───────────────────────────────────────────────────────────── */

/**
 * Gera o plano de publicação.
 *
 * @param {Object}   entrada
 * @param {Array}    entrada.accounts  [{ id, dailyLimit?, postsToday? }]
 * @param {Array}    entrada.contents  [{ id, name? }]
 * @param {Object}   entrada.strategy  { mode, seed }
 * @param {Object}   entrada.schedule  { intervalMin|intervalMinMinutes, intervalMax|…,
 *                                       useFixedInterval, windowStart, windowEnd, weekdays }
 * @param {Object}   entrada.settings  { coverage, respectDailyLimit }
 * @param {Object}   entrada.captions  { global, byAccount, byContent, byAccountContent }
 * @param {Object}   entrada.comments  { global, byAccount, byContent, byAccountContent }
 * @param {string}   entrada.captionMode
 * @param {string}   entrada.commentMode
 * @param {Date}     entrada.startAt   instante inicial (obrigatório — pureza)
 *
 * @returns {Array<{order, accountId, contentId, scheduledAt, captionTemplate, commentTemplate}>}
 */
function generatePlan({
  accounts = [],
  contents = [],
  strategy = {},
  schedule = {},
  settings = {},
  captions = {},
  comments = {},
  captionMode = 'global',
  commentMode = 'disabled',
  startAt,
} = {}) {
  _validarEntrada(accounts, contents, startAt);

  const cfg  = _normalizarSchedule(schedule);
  const rand = _criarRandom(strategy.seed);

  const pares = _montarPares(accounts, contents, settings);
  if (!pares.length) {
    // Acontece quando todas as contas já atingiram o limite diário.
    return [];
  }

  const ordenar = ESTRATEGIAS[strategy.mode] || ESTRATEGIAS.interleaved_random;
  const ordenados = ordenar(pares, rand);

  const plano = [];
  let instante = _proximoInstanteValido(new Date(startAt.getTime()), cfg);

  ordenados.forEach((par, indice) => {
    if (indice > 0) {
      const minutos = cfg.useFixedInterval
        ? cfg.intervalMin
        : _inteiroEntre(cfg.intervalMin, cfg.intervalMax, rand);
      instante = _proximoInstanteValido(
        new Date(instante.getTime() + minutos * 60_000),
        cfg
      );
    }

    plano.push({
      order:           indice + 1,
      accountId:       par.accountId,
      contentId:       par.contentId,
      scheduledAt:     new Date(instante.getTime()),
      captionTemplate: captionMode === 'disabled'
        ? ''
        : _escolherTemplate(captions, par.accountId, par.contentId),
      commentTemplate: commentMode === 'disabled'
        ? ''
        : _escolherTemplate(comments, par.accountId, par.contentId),
    });
  });

  return plano;
}

module.exports = {
  generatePlan,
  PlannerError,
  // Exportados para teste — permitem verificar as peças isoladamente sem
  // precisar montar um plano inteiro.
  _internals: {
    _criarRandom,
    _embaralhar,
    _montarPares,
    _escolherTemplate,
    _proximoInstanteValido,
    _normalizarSchedule,
    ESTRATEGIAS,
  },
};
