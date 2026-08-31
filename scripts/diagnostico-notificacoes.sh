#!/usr/bin/env bash
#
# Por que as notificações não aparecem.
#
# ── As cinco causas possíveis, e por que uma só resposta não serve
#
# "Não está funcionando" pode ser qualquer uma destas, e cada uma tem uma
# solução diferente:
#
#   1. o módulo está desligado na configuração;
#   2. nunca houve métrica nova — e sem métrica subindo não há marco. Foi o
#      caso durante toda a semana em que o proxy esteve fora do ar;
#   3. os tetos nunca foram semeados, então o sistema se recusa a disparar
#      para não despejar centenas de avisos de uma vez;
#   4. as notificações existem no banco e é a TELA que não as busca;
#   5. existem na tela, e o que falta é só o aviso no celular (chaves VAPID).
#
# O script diz qual das cinco é.
#
# ── A armadilha na volta
#
# Semear é o que impede a enxurrada. Sem os tetos gravados, a primeira
# sincronização bem-sucedida vê uma conta com 500 mil visualizações e nenhum
# marco registrado — e dispara TODOS os marcos abaixo disso, de uma vez, para
# cada conteúdo. Semear grava "este já passou por aqui" sem notificar nada.
#
#   ./scripts/diagnostico-notificacoes.sh            só diagnostica
#   ./scripts/diagnostico-notificacoes.sh --semear   semeia os tetos
#
set -euo pipefail
cd "$(dirname "$0")/.."

SEMEAR=0
[ "${1:-}" = "--semear" ] && SEMEAR=1

echo "════════════════════════════════════════════════════════"
echo " NOTIFICAÇÕES — por que não aparecem"
echo "════════════════════════════════════════════════════════"
echo

docker compose exec -T -e SEMEAR="$SEMEAR" backend node -e '
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Insight   = require("/app/src/models/Insight");
  const Milestone = require("/app/src/models/Milestone");
  const Notif     = require("/app/src/models/Notificacao");
  const Push      = require("/app/src/models/PushSubscription");
  const Setting   = require("/app/src/models/Setting");
  const thresholds = require("/app/src/services/smartActivity/thresholds");
  const detector   = require("/app/src/services/smartActivity/detector");

  const cfg = await thresholds.carregar();
  const semeado = await Setting.findOne({ key: detector.CHAVE_SEMEADO }).lean();
  const [insights, marcos, avisos, naoLidos, inscricoes] = await Promise.all([
    Insight.countDocuments({}),
    Milestone.countDocuments({}),
    Notif.countDocuments({}),
    Notif.countDocuments({ lidaEm: null }),
    Push.countDocuments({}),
  ]);

  const ultimo = await Insight.findOne({}).sort({ updatedAt: -1 }).select("updatedAt").lean();
  const horas = ultimo ? (Date.now() - new Date(ultimo.updatedAt)) / 3.6e6 : null;

  const temVapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  /* De onde vem cada métrica. Isto não é detalhe: story e post têm FONTES
     diferentes, e só uma delas funciona sem token da Meta.

     `storyInsightSync` varre contas instagrapi. `insightSyncService`, que é
     quem grava métrica de POST, exige `accessToken` e `igUserId` — o caminho
     Graph API. Numa base só instagrapi ele encontra zero contas e não faz
     nada, para sempre, mesmo com tudo o mais perfeito.

     Sem dizer isso, o diagnóstico manda conferir sessões quando metade do
     problema não é sessão nenhuma. */
  const Account = require("/app/src/models/Account");
  const [comGraph, comInstagrapi] = await Promise.all([
    Account.countDocuments({ accessToken: { $nin: [null, ""] }, igUserId: { $nin: [null, ""] } }),
    Account.countDocuments({ $or: [{ provider: "instagrapi" }, { instagrapiSession: { $nin: [null, ""] } }] }),
  ]);

  console.log("── 1. O módulo está ligado? ──────────────────");
  console.log("  visualizações de story : " + (cfg.ativos.storyViews   ? "SIM" : "não"));
  console.log("  visualizações de post  : " + (cfg.ativos.contentViews ? "SIM" : "não"));
  console.log("  alcance                : " + (cfg.ativos.reach        ? "SIM" : "não"));
  console.log("");

  console.log("── 2. Há métrica para observar? ──────────────");
  console.log("  insights no banco      : " + insights);
  console.log("  última atualização     : " +
    (horas === null ? "NUNCA" : horas.toFixed(1) + " h atrás"));
  console.log("");

  console.log("── 2b. Cada métrica tem fonte? ───────────────");
  console.log("  contas via instagrapi  : " + comInstagrapi + "   (alimenta STORY)");
  console.log("  contas com token Meta  : " + comGraph + "   (alimenta POST e ALCANCE)");
  if (!comGraph && (cfg.ativos.contentViews || cfg.ativos.reach)) {
    console.log("");
    console.log("  ATENÇÃO: \"visualizações de post\" e \"alcance\" estão LIGADOS e");
    console.log("  não têm fonte. Métrica de post vem da Graph API, que precisa de");
    console.log("  token da Meta — nenhuma conta tem. O serviço instagrapi expõe");
    console.log("  insight de story e nada além disso.");
    console.log("  Esses dois nunca vão disparar. Só os marcos de STORY podem.");
  }
  console.log("");

  console.log("── 3. Os tetos foram semeados? ───────────────");
  console.log("  semeado                : " + (semeado?.value?.feito ? "SIM" : "NÃO"));
  console.log("  marcos gravados        : " + marcos);
  console.log("");

  console.log("── 4. Existem notificações? ──────────────────");
  console.log("  no banco               : " + avisos + "  (" + naoLidos + " não lidas)");
  console.log("");

  console.log("── 5. Aviso no celular ───────────────────────");
  console.log("  chaves VAPID no serviço: " + (temVapid ? "SIM" : "NÃO"));
  console.log("  aparelhos inscritos    : " + inscricoes);
  console.log("");

  console.log("── Veredito ──────────────────────────────────");

  if (!cfg.ativos.storyViews && !cfg.ativos.contentViews) {
    console.log("  O módulo está DESLIGADO. Ligue em Configuração → Notificações.");
  } else if (!insights) {
    console.log("  Não há nenhum insight no banco. Sem métrica, não há o que");
    console.log("  observar — a notificação é consequência de um número subir.");
    console.log("  Conecte as contas e espere um ciclo de sincronização.");
  } else if (horas !== null && horas > 6) {
    console.log("  As métricas de STORY estão paradas há " + horas.toFixed(0) + " horas.");
    console.log("  A detecção lê o que a sincronização acabou de gravar; se ela");
    console.log("  não roda, nada é detectado. Confira as sessões primeiro:");
    console.log("    ./scripts/conferir-sessoes.sh");
  } else if (!semeado?.value?.feito) {
    console.log("  Os tetos NUNCA foram semeados, e é por isso que nada dispara.");
    console.log("");
    console.log("  Sem eles, a primeira detecção veria uma conta com centenas de");
    console.log("  milhares de visualizações e nenhum marco registrado — e");
    console.log("  dispararia todos os marcos abaixo disso, para cada conteúdo,");
    console.log("  de uma vez. Semear grava \"este já passou por aqui\" sem");
    console.log("  notificar nada, e a partir daí só o que SUBIR vira aviso.");
    console.log("");
    console.log("  Rode:  ./scripts/diagnostico-notificacoes.sh --semear");
  } else if (!avisos) {
    console.log("  Está tudo configurado e ainda não houve marco novo. Isso é");
    console.log("  normal logo depois de semear: só o que subir a partir de agora");
    console.log("  conta. O primeiro aviso chega quando uma métrica cruzar um");
    console.log("  marco — em story isso costuma levar horas, não dias.");
  } else if (!temVapid) {
    console.log("  Há " + avisos + " notificação(ões) no banco, então a detecção");
    console.log("  FUNCIONA. O que falta é só o aviso no celular: o serviço não");
    console.log("  tem chaves VAPID.");
    console.log("    ./scripts/gerar-chaves-push.sh");
  } else if (!inscricoes) {
    console.log("  Tudo pronto do lado do servidor, e nenhum aparelho inscrito.");
    console.log("  A inscrição é POR APARELHO: abra o painel no celular, vá em");
    console.log("  Configuração → Notificações e ligue o aviso ali.");
  } else {
    console.log("  Está tudo de pé: " + avisos + " notificações, " + inscricoes +
                " aparelho(s) inscrito(s).");
    console.log("  Se mesmo assim não chega, o problema é do lado do aparelho —");
    console.log("  permissão negada no navegador, ou iOS sem o app na tela de");
    console.log("  início, que é requisito da Apple para push em web.");
  }

  if (process.env.SEMEAR === "1") {
    console.log("");
    console.log("── Semeando ──────────────────────────────────");
    const r = await detector.semear();
    if (r.semeado) {
      console.log("  " + r.tetos + " teto(s) gravado(s). Nenhuma notificação foi");
      console.log("  disparada, que é o ponto: a partir daqui só o que SUBIR conta.");
    } else {
      console.log("  Não semeou — " + (r.motivo || "motivo desconhecido") + ".");
    }
  }

  await mongoose.disconnect();
})().catch(e => { console.log("Falhou: " + e.message); process.exit(1); });
' || {
  echo
  echo "  Não foi possível consultar. O backend está de pé?"
  echo "    docker compose ps backend"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
