'use strict';

/**
 * Detector de marcos.
 *
 * ── O que ele NÃO faz
 *
 * Não consulta o Instagram. Não altera o caminho de escrita das métricas. Não
 * sabe quando um ciclo de sincronização começou. Ele lê `Insight` — que o
 * sincronizador acabou de gravar — compara com o teto já notificado e decide.
 *
 * Essa separação é o ponto: a notificação é CONSEQUÊNCIA da métrica ter subido,
 * não uma segunda rotina correndo atrás dela. Nenhuma chamada adicional à API,
 * nenhum acoplamento com fila, publicação ou provider.
 *
 * ── A primeira execução
 *
 * Uma conta com meses de histórico tem posts que já passaram de todos os
 * marcos. Sem cuidado, a estreia do módulo despejaria centenas de notificações
 * de uma vez — e a primeira impressão do recurso seria uma avalanche de coisas
 * que aconteceram semanas atrás.
 *
 * `semear()` resolve: grava o teto no valor atual SEM notificar. A partir dali
 * só o que crescer de verdade dispara. É chamado uma vez, e o próprio ato de
 * semear fica registrado para não repetir.
 */

const { sql } = require('../../db');
const settings = require('../../repos/settings');
const thresholds = require('./thresholds');
const templates = require('./templates');

const CHAVE_SEMEADO = 'smartActivitySemeado';

/* ── Coalescência (20/09/2026) ─────────────────────────────────────────────
   Clicar em Sincronizar despejava dezenas de avisos de uma vez. Três causas,
   três regras:

   1. Um reel que saltou vários marcos entre duas leituras (0 → 194 mil)
      gerava um aviso POR marco: 100, 500, 1k, 5k … 100k — oito avisos do
      mesmo reel. Agora só o MAIOR marco cruzado vira aviso; os intermediários
      sobem o teto em silêncio. A pessoa quer saber que passou de 100 mil, não
      receber a escada inteira.

   2. Uma sincronização em que muitos reels cruzam marcos (o dia em que a
      conta estoura) virava uma avalanche. Por conta e por varredura, saem os
      ${LIMITE_POR_VARREDURA} maiores individualmente; o resto vira UM resumo
      ("mais 9 reels passaram de marcos — o maior: 194 mil").

   3. Conta conectada DEPOIS da semeadura global nascia com teto zero e, na
      primeira sincronização, disparava todo o histórico dela. Agora uma conta
      sem nenhum marco gravado é semeada na hora, sem avisar — só o que crescer a
      partir dali dispara. */
const LIMITE_POR_VARREDURA = 3;

/**
 * Grava a notificação. Devolve `null` quando o marco já tinha sido notificado
 * — o índice único é a segunda barreira contra duplicata, e colidir com ele é
 * resultado esperado, não erro.
 */
async function _gravar(doc, { push = true } = {}) {
  let nova;
  try {
    const { notificacoes } = require('../../repos');
    nova = await notificacoes.insert(doc);
  } catch (err) {
    if (err?.code === '23505') return null;   // outro ciclo chegou primeiro
    throw err;
  }
  try { require('../../events/broadcaster').broadcast('notificacoes', { novas: 1 }, nova.usuarioId); } catch { /* sem SSE */ }
  if (!push) return nova;   // quem chamou entrega um push só por todos (ver _entregarUmPush)

  /* Push depois de GRAVAR, e sem esperar.
  
     Depois porque o histórico é a fonte da verdade: uma notificação enviada e
     não gravada não existiria na Central. E sem `await` porque a entrega
     depende de um serviço externo — o servidor de push do navegador — e uma
     lentidão dele não pode segurar a varredura das outras contas.

     Falha aqui é silenciosa de propósito: o aviso interno já está gravado e
     vai aparecer assim que o painel abrir. Push é o extra. */
  try {
    const webPush = require('./webPush');
    if (webPush.disponivel()) {
      webPush.enviar(nova).catch(err =>
        console.warn('[WebPush] envio falhou:', err.message));
    }
  } catch { /* módulo indisponível não derruba a detecção */ }

  return nova;
}

/** Grava o último valor lido; com `teto`, sobe o maior marco disparado (nunca desce). */
async function _marco(accountId, contentId, metricType, valor, teto = 0) {
  await sql`
    insert into milestones (account_id, content_id, metric_type, maior_disparado, ultimo_valor)
    values (${accountId}, ${contentId}, ${metricType}, ${teto}, ${valor})
    on conflict (account_id, content_id, metric_type) do update set
      maior_disparado = greatest(milestones.maior_disparado, excluded.maior_disparado),
      ultimo_valor = excluded.ultimo_valor`;
}

/** Açúcar para deixar claro, no ponto de uso, que o push vem depois e é só um. */
const _gravarSemPush = doc => _gravar(doc, { push: false });

/**
 * Processa UM insight e devolve as notificações criadas.
 *
 * @param {object} insight  documento de Insight (lean)
 * @param {object} conta    { id, username, avatar }
 * @param {object} cfg      configuração já carregada
 */
async function processarInsight(insight, conta, cfg, { gravar = true } = {}) {
  const criadas = [];
  const ehStory = insight.mediaType === 'STORY';
  const metricas = ehStory ? ['storyViews'] : ['contentViews', 'reach'];

  for (const metricType of metricas) {
    if (!cfg.ativos[metricType]) continue;

    /* Lista fixa ou contínuo — o detector não precisa saber qual. */
    const regra = thresholds.regraDe(cfg, metricType);
    if (!regra) continue;

    const valor = thresholds.valorDaMetrica(insight, metricType);
    if (!valor) continue;

    const contentId = String(insight.igMediaId);
    const [marco] = await sql`
      select maior_disparado from milestones
      where account_id = ${conta.id} and content_id = ${contentId} and metric_type = ${metricType}`;
    const teto = marco?.maiorDisparado || 0;

    const cruzados = thresholds.marcosCruzados(teto, valor, regra);

    /* Mesmo sem marco novo, o último valor é atualizado: serve de diagnóstico
       e cria o documento na primeira passagem, o que evita `findOne` inútil
       nas próximas. */
    if (!cruzados.length) {
      await _marco(conta.id, contentId, metricType, valor);
      continue;
    }

    /* SOBE O TETO ANTES DE NOTIFICAR.

       Se a gravação da notificação falhar depois disto, perde-se um aviso. Na
       ordem inversa, uma falha ao subir o teto faria o MESMO marco disparar de
       novo no ciclo seguinte — e de novo, e de novo. Entre perder uma
       notificação e repetir a mesma para sempre, perder é o erro menor. */
    const maior = cruzados[cruzados.length - 1];
    await _marco(conta.id, contentId, metricType, valor, maior);

    const modelo = templates.modeloDe(metricType, cfg.mensagens);

    /* Só o MAIOR marco cruzado vira aviso (regra 1). Os intermediários já
       subiram o teto acima; não voltam a disparar. */
    const threshold = maior;
    const vars = templates.contexto({ conta, insight, threshold, valor, metricType,
      /* O que a pessoa pediu para nao aparecer na tela de bloqueio.
         Aplicado aqui, onde as variaveis nascem, e nao no render: assim
         vale para a Central e para o push com um caminho so. */
      privacidade: cfg.privacidade });
    const doc = {
      accountId: conta.id,
      username: conta.username || '',
      avatar: conta.avatar || '',
      contentId,
      eventType: 'milestone',
      metricType,
      threshold,
      tema: modelo.tema,
      prioridade: threshold >= 10000 ? 'alta' : 'normal',
      titulo: templates.render(modelo.titulo, vars),
      mensagem: templates.render(modelo.mensagem, vars),
      metadados: {
        valor,
        mediaType: insight.mediaType || '',
        permalink: insight.permalink || '',
        thumbnailUrl: insight.thumbnailUrl || '',
        postedAt: insight.postedAt || null,
      },
    };
    if (!gravar) { criadas.push(doc); continue; }
    const nova = await _gravar(doc);
    if (nova) criadas.push(nova);
  }

  return criadas;
}

/**
 * Semeia UMA conta: grava o teto de cada conteúdo no maior marco já
 * ultrapassado, sem notificar (regra 3). Devolve quantos tetos gravou.
 */
async function semearConta(conta, cfg) {
  const insights = await sql`
    select ig_media_id, media_type, impressions, reach, video_views from insights where account_id = ${conta.id}`;
  let tetos = 0;
  for (const ins of insights) {
    const ehStory = ins.mediaType === 'STORY';
    for (const metricType of (ehStory ? ['storyViews'] : ['contentViews', 'reach'])) {
      const regra = thresholds.regraDe(cfg, metricType);
      const valor = thresholds.valorDaMetrica(ins, metricType);
      if (!valor || !regra) continue;
      await _marco(conta.id, String(ins.igMediaId), metricType, valor, thresholds.pisoDe(valor, regra));
      tetos++;
    }
  }
  return tetos;
}

/**
 * UM push por varredura — o registro continua um por marco.
 *
 * ── O que a pessoa via
 *
 * As métricas do Instagram só podem ser lidas de tempos em tempos (a cada 30
 * min), e TODAS as contas são lidas na mesma passada. Então todo marco daquela
 * passada nasce no mesmo segundo: quatro avisos às 17:09:26, nada até
 * 17:39:36, mais quatro. Medido em produção — e é exatamente o "chega tudo em
 * lote de uma hora pra outra".
 *
 * Reduzir a quantidade (o teto global) não resolveu porque o problema não é
 * quantos são, é o celular tocar quatro vezes seguidas e depois silenciar meia
 * hora.
 *
 * ── O que muda
 *
 * A Central continua recebendo um cartão por marco — é o histórico, e é lá que
 * se vê qual reel foi. O CELULAR recebe um toque só: o marco, quando é um; um
 * resumo ("4 conteúdos passaram de marcos — o maior: @conta com 12 mil"),
 * quando são vários.
 *
 * O que isto NÃO conserta: a detecção continua de meia em meia hora. Um marco
 * atingido às 17:15 aparece às 17:39. Isso é limite da API de métricas do
 * Instagram, não deste código.
 */
async function _entregarUmPush(criadas, cfg, { enviar, usuarioId = criadas[0]?.usuarioId } = {}) {
  if (!criadas.length) return;
  if (!enviar) {
    try {
      const webPush = require('./webPush');
      if (!webPush.disponivel()) return;
      enviar = n => webPush.enviar(n);
    } catch { return; }
  }

  if (criadas.length === 1) {
    console.log('[SmartActivity] varredura: 1 aviso na Central, 1 push');
    Promise.resolve(enviar(criadas[0])).catch(err => console.warn('[WebPush] envio falhou:', err.message));
    return;
  }
  /* A linha existe para responder, do log, a pergunta que só o dono do
     celular conseguia responder antes: "quantas vezes o aparelho tocou?". */
  console.log(`[SmartActivity] varredura: ${criadas.length} avisos na Central, 1 push (resumo)`);

  /* O maior valor dá o rosto do resumo: é o que a pessoa quer abrir primeiro.
     `discretas` respeita "não mostrar nome/valor" na tela de bloqueio, igual
     ao resto — esconder no cartão e revelar no push seria esconder pela
     metade. */
  const marcos = criadas.filter(n => n.eventType === 'milestone');
  const maior = [...(marcos.length ? marcos : criadas)]
    .sort((a, b) => (b.metadados?.valor || 0) - (a.metadados?.valor || 0))[0];
  const vars = templates.discretas({
    quantidade: String(criadas.length),
    account: maior?.username ? `@${maior.username}` : 'uma conta',
    maior: templates.formatarNumero(maior?.metadados?.valor || 0),
  }, cfg?.privacidade || {});

  Promise.resolve(enviar({
    /* Id próprio: no service worker o `tag` vem daqui, e um id fixo faria o
       resumo desta varredura SUBSTITUIR o da anterior sem avisar. */
    id: `varredura-${Date.now()}`,
    usuarioId,
    titulo: `${vars.quantidade} marcos nas suas contas 🚀`,
    mensagem: `O maior: ${vars.account} com ${vars.maior}. Abra a Central para ver todos.`,
    tema: 'viral',
    username: maior?.username || '',
  })).catch(err => console.warn('[WebPush] envio falhou:', err.message));
}

/* Quando o MESMO conteúdo cruza marco de views e de alcance na mesma
   varredura, só um aviso: o de views. São dois números do mesmo reel, e o
   segundo só dobrava a pilha. */
const PRIORIDADE_DA_METRICA = { contentViews: 3, storyViews: 2, reach: 1 };

function _umPorConteudo(candidatos) {
  const porConteudo = new Map();
  for (const c of candidatos) {
    const chave = `${c.accountId}:${c.contentId}`;
    const atual = porConteudo.get(chave);
    if (!atual || (PRIORIDADE_DA_METRICA[c.metricType] || 0) > (PRIORIDADE_DA_METRICA[atual.metricType] || 0)) porConteudo.set(chave, c);
  }
  return [...porConteudo.values()];
}

/**
 * Grava os candidatos de UMA VARREDURA (todas as contas) respeitando o limite
 * global (regra 2): os LIMITE maiores saem inteiros; o resto vira UM resumo,
 * assinado pela conta do maior deles.
 */
async function _gravarCoalescido(candidatos, cfg) {
  const criadas = [];
  if (!candidatos.length) return criadas;
  const ordenados = _umPorConteudo(candidatos).sort((a, b) => (b.metadados?.valor || 0) - (a.metadados?.valor || 0));
  const individuais = ordenados.slice(0, LIMITE_POR_VARREDURA);
  const resto = ordenados.slice(LIMITE_POR_VARREDURA);

  for (const doc of individuais) {
    const nova = await _gravar(doc, { push: false });
    if (nova) criadas.push(nova);
  }
  if (!resto.length) {
    await _entregarUmPush(criadas, cfg);
    return criadas;
  }

  const maior = resto[0];
  const contasNoResto = new Set(resto.map(d => String(d.accountId)));
  const modelo = templates.modeloDe('resumoMarcos', cfg.mensagens);
  const vars = templates.discretas({
    username: maior.username || '',
    account: maior.username ? `@${maior.username}` : 'uma conta',
    quantidade: String(resto.length),
    contas: String(contasNoResto.size),
    maior: templates.formatarNumero(maior.metadados?.valor || 0),
  }, cfg.privacidade || {});
  const resumo = await _gravarSemPush({
    accountId: maior.accountId,
    username: maior.username || '',
    avatar: maior.avatar || '',
    eventType: 'resumoMarcos',
    tema: modelo.tema,
    prioridade: 'normal',
    titulo: templates.render(modelo.titulo, vars),
    mensagem: templates.render(modelo.mensagem, vars),
    metadados: {
      quantidade: resto.length,
      conteudos: resto.map(d => ({ contentId: d.contentId, metricType: d.metricType, threshold: d.threshold, valor: d.metadados?.valor || 0, permalink: d.metadados?.permalink || '' })),
    },
  });
  if (resumo) criadas.push(resumo);
  await _entregarUmPush(criadas, cfg);
  return criadas;
}

/**
 * Varre os insights de um conjunto de contas.
 *
 * Chamado no FIM de um ciclo de sincronização, com as contas que aquele ciclo
 * tocou. Passar a lista evita varrer a base inteira a cada ciclo.
 *
 * @param {Array} contas  [{ id, username, avatar }]
 * @param {object} opcoes { apenasStories }
 */
async function varrer(contas = [], { apenasStories = false } = {}) {
  if (!contas.length) return [];

  /* Por dono: cada usuário tem a própria configuração de marcos, e o limite
     de avisos por varredura vale para cada um — a conta de um não gasta a
     cota de avisos do outro. */
  const semDono = contas.filter(c => !c.usuarioId).map(c => c.id);
  const donos = semDono.length
    ? new Map((await sql`select id, usuario_id from accounts where id = any(${semDono}::uuid[])`).map(r => [r.id, r.usuarioId]))
    : new Map();
  const porDono = new Map();
  for (const conta of contas) {
    const dono = conta.usuarioId || donos.get(conta.id);
    if (!dono) continue;
    if (!porDono.has(dono)) porDono.set(dono, []);
    porDono.get(dono).push(conta);
  }

  const criadas = [];
  for (const [usuarioId, doDono] of porDono) {
    criadas.push(...await _varrerDoDono(usuarioId, doDono, { apenasStories }));
  }
  return criadas;
}

async function _varrerDoDono(usuarioId, contas, { apenasStories }) {
  const cfg = await thresholds.carregar(usuarioId);
  const criadas = [];
  const candidatos = [];

  for (const conta of contas) {
    /* Conta que nunca passou por aqui (regra 3): semeia e segue — nada a
       avisar sobre o que já aconteceu antes de ela existir no painel. */
    const [jaConhecida] = await sql`select 1 from milestones where account_id = ${conta.id} limit 1`;
    if (!jaConhecida) {
      const tetos = await semearConta(conta, cfg);
      if (tetos) console.log(`[SmartActivity] @${conta.username || conta.id}: conta nova, ${tetos} teto(s) semeado(s) sem avisar`);
      continue;
    }

    /* Só o que foi sincronizado há pouco. Sem este corte, cada ciclo releria
       todo o histórico da conta para concluir que nada mudou. */
    const desde = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const insights = await sql`
      select * from insights
      where account_id = ${conta.id} and synced_at >= ${desde}
        and ${apenasStories ? sql`media_type = 'STORY'` : sql`media_type <> 'STORY'`}
      limit 200`;

    for (const insight of insights) {
      try {
        candidatos.push(...await processarInsight(insight, conta, cfg, { gravar: false }));
      } catch (err) {
        // Um insight problemático não derruba a varredura dos outros.
        console.warn(`[SmartActivity] ${insight.igMediaId}: ${err.message}`);
      }
    }
  }

  /* UMA coalescência para a varredura inteira, não uma por conta. "3 por
     conta + resumo" com seis contas ainda era uma rajada de 12–15 a cada 30
     min — medido em produção. Agora: 3 no total + 1 resumo geral. Os tetos
     dos que não saem já subiram em processarInsight: não voltam a disparar. */
  criadas.push(...await _gravarCoalescido(candidatos, cfg));
  return criadas;
}

/**
 * Semeia os tetos com os valores atuais, SEM notificar.
 *
 * Roda uma vez. Sem isso, ligar o módulo numa conta com histórico dispararia
 * todos os marcos já ultrapassados de uma vez — centenas de avisos sobre
 * coisas que aconteceram semanas atrás.
 */
async function semear() {
  const ja = await settings.ler(CHAVE_SEMEADO);
  if (ja?.feito) return { semeado: false, motivo: 'já feito' };

  const insights = await sql`select account_id, usuario_id, ig_media_id, media_type, impressions, reach, video_views from insights`;
  const cfgs = new Map();

  let tetos = 0;
  for (const ins of insights) {
    if (!cfgs.has(ins.usuarioId)) cfgs.set(ins.usuarioId, await thresholds.carregar(ins.usuarioId));
    const cfg = cfgs.get(ins.usuarioId);
    const ehStory = ins.mediaType === 'STORY';
    for (const metricType of (ehStory ? ['storyViews'] : ['contentViews', 'reach'])) {
      const regra = thresholds.regraDe(cfg, metricType);
      const valor = thresholds.valorDaMetrica(ins, metricType);
      if (!valor || !regra) continue;
      // O maior marco que este valor já ultrapassou vira o piso.
      await _marco(ins.accountId, String(ins.igMediaId), metricType, valor, thresholds.pisoDe(valor, regra));
      tetos++;
    }
  }

  await settings.gravar(CHAVE_SEMEADO, { feito: true, em: new Date(), tetos });
  return { semeado: true, tetos };
}

/**
 * Resumo do dia — a notificação global.
 *
 * ── Por que ela é diferente das outras
 *
 * Marco é um fato pontual: aquele story passou de mil. Resumo é um retrato do
 * conjunto, e não tem "marco" para cruzar — ele acontece porque o dia passou.
 * Por isso o anti-repetição aqui não é o teto: é a data. Um resumo por dia,
 * e o próprio registro no banco é quem diz se o de hoje já saiu.
 *
 * ── Por que só sai a partir das 22h
 *
 * "Um por dia" sozinho não bastava. Esta função roda no fim de CADA ciclo de
 * sincronização (a cada 30 min), então o resumo saía no primeiro ciclo depois
 * da primeira publicação do dia — às 9h da manhã, dizendo "1 publicação" — e
 * travava até o dia seguinte. As outras quarenta ficavam sem resumo nenhum.
 *
 * O pedido é o total do dia, NO FINAL do dia. Então ele espera a hora e sai no
 * primeiro ciclo depois dela, cobrindo tudo que saiu até ali. O fuso é o do
 * contêiner (`TZ=America/Sao_Paulo` no compose), o mesmo que define o "hoje"
 * de `inicioDoDia` logo abaixo — um relógio só para as duas decisões.
 *
 * `agora` entra por parâmetro para o teste poder fixar a hora; em produção
 * ninguém passa nada.
 */
const HORA_DO_RESUMO = 22;                 // legado — o padrão de PADRAO.resumo.hora
const HORA_PADRAO_DO_RESUMO = '22:00';

/** Um resumo por usuário ativo que tenha publicado no dia. */
async function resumoDoDia({ agora = new Date() } = {}) {
  const usuarios = await sql`select id from usuarios where status = 'ativo'`;
  const criados = [];
  for (const { id } of usuarios) {
    const n = await _resumoDoUsuario(id, { agora }).catch(err => {
      console.warn(`[SmartActivity] resumo de ${id}: ${err.message}`);
      return null;
    });
    if (n) criados.push(n);
  }
  return criados;
}

async function _resumoDoUsuario(usuarioId, { agora }) {
  const cfg = await thresholds.carregar(usuarioId);
  if (!cfg.ativos.global) return null;

  /* A hora agora é configuração (Notificações → Comportamento), não a
     constante. Configuração ilegível cai no padrão de sempre, 22h. */
  const hora = thresholds.normalizarHora(cfg.resumo?.hora) || HORA_PADRAO_DO_RESUMO;
  if (agora.getHours() * 60 + agora.getMinutes() < thresholds.minutosDe(hora)) return null;

  const inicioDoDia = new Date(agora);
  inicioDoDia.setHours(0, 0, 0, 0);

  /* Um por dia. A checagem é no banco e não em memória: o processo reinicia,
     a memória some, e o resumo sairia de novo. */
  const [jaSaiu] = await sql`
    select 1 from notificacoes
    where event_type = 'resumo' and usuario_id = ${usuarioId} and criada_em >= ${inicioDoDia} limit 1`;
  if (jaSaiu) return null;

  /* STORY fora do total de posts — mesma separação de analyticsController.js:
     visualização de story não é uma publicação nova. */
  const [[agregado], [storyAgregado], porContaAgregado] = await Promise.all([
    sql`select count(*) as publicacoes, count(distinct account_id) as contas,
          coalesce(sum(video_views), 0) as views
        from insights where usuario_id = ${usuarioId} and posted_at >= ${inicioDoDia} and media_type <> 'STORY'`,
    sql`select coalesce(sum(impressions), 0) as views
        from insights where usuario_id = ${usuarioId} and posted_at >= ${inicioDoDia} and media_type = 'STORY'`,
    sql`select account_id, max(username) as username,
          coalesce(sum(video_views), 0) as views
        from insights where usuario_id = ${usuarioId} and posted_at >= ${inicioDoDia} and media_type <> 'STORY'
        group by account_id order by views desc limit 12`,
  ]);

  if (!agregado || !agregado.publicacoes) return null;

  const viewsStories = storyAgregado?.views || 0;

  /* A privacidade de nome entra AQUI, não em `discretas()`: aquela função só
     sabe trocar o VALOR inteiro de um campo, e `porConta` é uma frase com
     vários @ dentro — teria que reconstruí-la para redigir cada nome, o que
     é exatamente o que já se está fazendo. */
  const mostrarNome  = cfg.privacidade?.mostrarNome  !== false;
  const mostrarValor = cfg.privacidade?.mostrarValor !== false;
  const porConta = porContaAgregado
    .filter(c => c.views > 0)
    .map((c, i) => {
      const nome = mostrarNome ? `@${c.username || 'conta'}` : `Conta ${i + 1}`;
      const num  = mostrarValor ? templates.formatarNumero(c.views) : '•••';
      return `${nome}: ${num}`;
    })
    .join(' · ') || 'Sem visualizações registradas ainda hoje.';

  const modelo = templates.modeloDe('resumo', cfg.mensagens);
  /* `discretas` tambem aqui: o resumo diz quantas visualizacoes o dia teve, e
     esconder o numero nos marcos e mostra-lo no resumo esconde pela metade. */
  const vars = templates.discretas({
    publicacoes:  templates.formatarNumero(agregado.publicacoes),
    contas:       templates.formatarNumero(agregado.contas || 0),
    views:        templates.formatarNumero(agregado.views || 0),
    viewsStories: templates.formatarNumero(viewsStories),
    porConta,
  }, cfg.privacidade || {});

  return _gravar({
    usuarioId,
    accountId: null,
    eventType: 'resumo',
    tema: modelo.tema,
    prioridade: 'baixa',
    titulo: templates.render(modelo.titulo, vars),
    mensagem: templates.render(modelo.mensagem, vars),
    metadados: {
      publicacoes: agregado.publicacoes,
      contas: agregado.contas || 0,
      views: agregado.views || 0,
      viewsStories,
      porConta: porContaAgregado.map(c => ({ accountId: c.accountId, username: c.username, views: c.views })),
    },
  });
}

module.exports = {
  semearConta, _gravarCoalescido, _entregarUmPush, LIMITE_POR_VARREDURA, processarInsight, varrer, semear, resumoDoDia, _resumoDoUsuario, CHAVE_SEMEADO, HORA_DO_RESUMO,
  HORA_PADRAO_DO_RESUMO, iniciarRelogioDoResumo };

/**
 * O resumo tem hora marcada — então tem relógio próprio.
 *
 * Antes ele só era tentado no fim de cada ciclo de sincronização, a cada 30
 * min: "às 22h" queria dizer "entre 22:00 e 22:30, depende". Com a hora
 * escolhida pela pessoa, atrasar meia hora é errar o pedido. Um tique por
 * minuto; a checagem barata (`carregar` + uma consulta) e o "um por dia" no
 * banco seguram a repetição. A chamada no fim da sincronização continua — é
 * inofensiva e cobre o minuto em que este relógio estiver reiniciando.
 */
function iniciarRelogioDoResumo({ intervaloMs = 60_000 } = {}) {
  const tique = async () => {
    try {
      await resumoDoDia();
    } catch (err) {
      console.warn('[SmartActivity] resumo do dia falhou:', err.message);
    }
  };
  const t = setInterval(tique, intervaloMs);
  if (typeof t.unref === 'function') t.unref();
  return t;
}
