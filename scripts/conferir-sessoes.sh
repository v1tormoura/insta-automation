#!/usr/bin/env bash
#
# Pergunta ao Instagram, conta por conta, se a sessão ainda vale.
#
# ── O que este script responde
#
# "As contas aparecem como sessão expirada" é uma afirmação sobre o que está
# GRAVADO. Ela pode estar velha: o marcador foi posto quando o proxy estava
# fora do ar, e continua lá depois de a rede voltar, até alguém verificar.
#
# Aqui a verificação acontece agora, pelo mesmo caminho que o health check usa
# em produção — o que significa duas coisas:
#
#   1. o resultado é o que o Instagram responde, não o que o banco lembra;
#   2. verificar CURA. Um ping bem-sucedido chama `recordSuccess`, que zera o
#      contador de falhas e devolve a conta para "ativa". Não é preciso esperar
#      o ciclo de cinco minutos nem mexer no banco à mão.
#
# ── E a segunda pergunta: está AGUENTANDO?
#
# Uma sessão pode passar num teste e morrer no seguinte. Por isso o script faz
# duas rodadas separadas por uma pausa, e compara. Uma conta que passa nas duas
# está de pé; uma que passa na primeira e falha na segunda está sendo derrubada
# por algo entre elas — quase sempre o IP de saída mudando no meio.
#
#   ./scripts/conferir-sessoes.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

PAUSA="${1:-45}"   # segundos entre as duas rodadas

echo "════════════════════════════════════════════════════════"
echo " AS SESSÕES ESTÃO DE PÉ?"
echo "════════════════════════════════════════════════════════"
echo
echo "Perguntando ao Instagram. São duas rodadas com ${PAUSA}s de intervalo,"
echo "então leva alguns minutos."
echo

docker compose exec -T -e PAUSA="$PAUSA" backend node -e '
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Account = require("/app/src/models/Account");
  const { checkViaInstagrapi } = require("/app/src/jobs/healthCheck");

  const contas = await Account.find({
    $or: [
      { provider: "instagrapi" },
      { instagrapiSession: { $exists: true, $ne: "" } },
    ],
  }).select("username _id provider instagrapiSession healthStatus consecutiveFailures proxy lastSuccessfulRequestAt");

  if (!contas.length) {
    console.log("  Nenhuma conta com sessão instagrapi.");
    await mongoose.disconnect();
    return;
  }

  const pausa = ms => new Promise(r => setTimeout(r, ms));

  async function rodada(rotulo) {
    console.log("── " + rotulo + " ───────────────────────────────");
    const saida = new Map();
    for (const c of contas) {
      let r;
      try { r = await checkViaInstagrapi(c); }
      catch (e) { r = { status: null, error: e.message.slice(0, 60) }; }

      // status null = erro técnico: não diz nada sobre a sessão.
      const veredito = r.status === "ativa" ? "DE PÉ"
                     : r.status === "sessao_expirada" ? "expirada"
                     : r.status === "restrita" ? "restrita (desafio)"
                     : r.status ? r.status
                     : "não deu para saber";
      /* Grava o veredito. `checkViaInstagrapi` só RESPONDE — quem escreve no
         banco é o `checkOneAccount`, e sem isto a tela continuaria mostrando
         "sessão expirada" numa conta que acabou de responder que está de pé.
         Erro técnico (status null) não escreve nada: ele não diz nada sobre a
         sessão, e sobrescrever aqui seria trocar um marcador velho por outro
         igualmente sem base. */
      if (r.status) {
        await Account.findByIdAndUpdate(c._id, {
          healthStatus:    r.status,
          lastError:       r.status === "ativa" ? "" : (r.error || ""),
          lastHealthCheck: new Date(),
          ...(r.status === "ativa" ? { lastValidatedAt: new Date() } : {}),
        });
      }

      saida.set(String(c._id), veredito);
      console.log("  @" + (c.username || "?").padEnd(22) + veredito
        + (r.error && r.status !== "ativa" ? "  — " + String(r.error).slice(0, 60) : ""));
      await pausa(800);   // gentileza com o Instagram
    }
    console.log("");
    return saida;
  }

  const um = await rodada("Rodada 1");

  console.log("Aguardando " + process.env.PAUSA + "s antes da segunda rodada…");
  console.log("");
  await pausa(Number(process.env.PAUSA) * 1000);

  const dois = await rodada("Rodada 2");

  console.log("── Veredito ──────────────────────────────────");
  let firmes = 0, instaveis = 0, mortas = 0, indefinidas = 0;
  for (const c of contas) {
    const id = String(c._id);
    const a = um.get(id), b = dois.get(id);
    if (a === "DE PÉ" && b === "DE PÉ") firmes++;
    else if (a === "DE PÉ" || b === "DE PÉ") {
      instaveis++;
      console.log("  @" + c.username + " oscilou: " + a + " -> " + b);
    }
    else if (a === "expirada" && b === "expirada") mortas++;
    else indefinidas++;
  }

  console.log("");
  console.log("  de pé nas duas rodadas : " + firmes);
  console.log("  oscilando              : " + instaveis);
  console.log("  expiradas de verdade   : " + mortas);
  console.log("  indefinidas (rede)     : " + indefinidas);
  console.log("");

  if (firmes) {
    console.log("  As que estão de pé já foram devolvidas para \"ativa\" no banco —");
    console.log("  a própria verificação zera o contador de falhas.");
  }
  if (instaveis) {
    console.log("  Oscilar entre as rodadas quase sempre é o IP de saída mudando no");
    console.log("  meio. Rode ./scripts/sondar-proxy.sh para medir a estabilidade.");
  }
  if (mortas) {
    console.log("  As expiradas nas duas rodadas precisam ser reconectadas pelo painel:");
    console.log("  aí o Instagram recusou de verdade, e não há o que consertar daqui.");
  }
  if (indefinidas) {
    console.log("  \"Indefinidas\" são erro de rede, não de sessão: o teste não chegou ao");
    console.log("  Instagram. Confira o proxy antes de concluir qualquer coisa sobre elas.");
  }

  await mongoose.disconnect();
})().catch(e => { console.log("Falhou: " + e.message); process.exit(1); });
' || {
  echo
  echo "  Não foi possível verificar. O backend está de pé?"
  echo "    docker compose ps backend"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
