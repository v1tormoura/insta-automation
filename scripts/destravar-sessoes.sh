#!/usr/bin/env bash
#
# Zera o contador de falhas das contas que foram marcadas como "sessão
# expirada" sem que a sessão tenha expirado.
#
# ── Por que é preciso rodar isto uma vez
#
# O defeito era o contador `consecutiveFailures` somar qualquer erro — timeout,
# proxy caído, serviço Python reiniciando — e não só os que dizem algo sobre a
# sessão. Ao chegar em 5, a conta passa a ser tratada como inválida e o painel
# anuncia "sessão expirada", com o blob da sessão intacto no banco.
#
# A correção impede que isso volte a acontecer, mas não desfaz o que já está
# gravado: uma conta que já está em 5 continua reprovando na validação, porque
# a validação lê o número, não a história dele.
#
# ── O que este script faz, e o que ele NÃO faz
#
# Zera o contador SÓ das contas que ainda têm sessão gravada. Conta sem sessão
# está corretamente marcada e não é tocada — nesse caso "expirada" é verdade.
#
# Ele não afirma que a sessão funciona. Quem afirma isso é o Instagram, e é o
# health check que vai perguntar, agora sem o contador falso no caminho. Se
# alguma sessão estiver mesmo morta, ela volta a ser marcada na próxima ronda
# — dessa vez por uma resposta do Instagram, não por aritmética.
#
#   ./scripts/destravar-sessoes.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo " DESTRAVAR SESSÕES MARCADAS POR ENGANO"
echo "════════════════════════════════════════════════════════"
echo

docker compose exec -T mongo mongosh insta-automation --quiet --eval '
const comSessao = {
  instagrapiSession: { $nin: [null, ""] },
};

const candidatas = db.accounts.find({
  ...comSessao,
  $or: [
    { healthStatus: "sessao_expirada" },
    { consecutiveFailures: { $gte: 1 } },
  ],
}, { username: 1, healthStatus: 1, consecutiveFailures: 1, sessionStatus: 1 }).toArray();

if (!candidatas.length) {
  print("  Nenhuma conta travada. Nada a fazer.");
} else {
  print("── Contas que serão destravadas ──────────────");
  candidatas.forEach(c => {
    print("  @" + (c.username || "?").padEnd(24)
      + "falhas " + String(c.consecutiveFailures || 0).padEnd(4)
      + "saúde " + (c.healthStatus || "-"));
  });
  print("");

  const r = db.accounts.updateMany(
    { _id: { $in: candidatas.map(c => c._id) } },
    {
      $set: {
        consecutiveFailures: 0,
        sessionStatus: "UNKNOWN",
        healthStatus: "ativa",
        lastError: "",
      },
    }
  );
  print("  " + r.modifiedCount + " conta(s) destravada(s).");
}

print("");
print("── Contas sem sessão gravada (não tocadas) ───");
const semSessao = db.accounts.countDocuments({
  $and: [
    { $or: [ { instagrapiSession: null }, { instagrapiSession: "" }, { instagrapiSession: { $exists: false } } ] },
    { healthStatus: "sessao_expirada" },
  ],
});
if (semSessao) {
  print("  " + semSessao + " — para estas, \"expirada\" é verdade: reconecte pelo painel.");
} else {
  print("  nenhuma");
}
' 2>/dev/null || {
  echo "  Não foi possível consultar o Mongo. O contêiner está de pé?"
  echo "    docker compose ps mongo"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
echo "O health check vai reavaliar cada uma perguntando ao Instagram."
echo "Se alguma sessão estiver mesmo morta, volta a ser marcada — dessa vez"
echo "por uma resposta de verdade, e aí reconectar resolve."
