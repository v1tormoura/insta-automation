#!/usr/bin/env bash
#
# Estado real das conexões de conta — API Mobile (instagrapi) e Graph API.
#
# ── Por que este script existe
#
# "Está tudo conectando certinho?" não se responde lendo código. O código pode
# estar correto e as contas mesmo assim não conectarem, porque o que decide é o
# Instagram — e ele decide por conta, por IP e por histórico.
#
# Aqui não há opinião: só o que está gravado no banco e o que apareceu nos logs.
#
#   ./scripts/diagnostico-conexoes.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo " CONEXÕES — estado atual"
echo "════════════════════════════════════════════════════════"
echo

docker compose exec -T mongo mongosh insta-automation --quiet --eval '
const linha = (r, v) => print("  " + String(r).padEnd(28) + v);

print("── Por provedor ──────────────────────────────");
db.accounts.aggregate([
  { $group: { _id: "$provider", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach(d => linha(d._id || "(sem provedor)", d.n));

print("");
print("── Saúde ─────────────────────────────────────");
db.accounts.aggregate([
  { $group: { _id: "$healthStatus", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach(d => linha(d._id || "(vazio)", d.n));

print("");
print("── Sessão instagrapi ─────────────────────────");
db.accounts.aggregate([
  { $match: { $or: [ { provider: "instagrapi" }, { instagrapiSession: { $exists: true, $ne: null } } ] } },
  { $group: { _id: "$sessionStatus", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach(d => linha(d._id || "(nunca conectou)", d.n));

print("");
print("── Credenciais e 2FA ─────────────────────────");
linha("com senha guardada",  db.accounts.countDocuments({ password: { $nin: [null, ""] } }));
linha("com 2FA (TOTP)",      db.accounts.countDocuments({ totpSecret: { $nin: [null, ""] } }));
linha("SEM 2FA",             db.accounts.countDocuments({ $or: [ { totpSecret: null }, { totpSecret: "" }, { totpSecret: { $exists: false } } ] }));
linha("com sessão gravada",  db.accounts.countDocuments({ instagrapiSession: { $ne: null } }));
linha("com token Graph",     db.accounts.countDocuments({ accessToken: { $nin: [null, ""] } }));

print("");
print("── Proxy ─────────────────────────────────────");
linha("conta com proxy próprio", db.accounts.countDocuments({ proxy: { $nin: [null, ""] } }));
linha("com IP de saída aferido", db.accounts.countDocuments({ proxyIp: { $nin: [null, ""] } }));
try {
  linha("no pool, livres",   db.proxypool.countDocuments({ contaId: null, ok: { $ne: false } }));
  linha("no pool, em uso",   db.proxypool.countDocuments({ contaId: { $ne: null } }));
  linha("no pool, sem resposta", db.proxypool.countDocuments({ ok: false }));
} catch (e) { linha("pool de proxies", "coleção ausente"); }

print("");
print("── Contas com problema, uma a uma ────────────");
const ruins = db.accounts.find(
  { healthStatus: { $nin: ["ativa", null] } },
  { username: 1, provider: 1, healthStatus: 1, sessionStatus: 1, lastError: 1, lastLoginAt: 1 }
).limit(20).toArray();

if (!ruins.length) print("  nenhuma — todas marcadas como ativa");
ruins.forEach(a => {
  const quando = a.lastLoginAt ? new Date(a.lastLoginAt).toISOString().slice(0, 16).replace("T", " ") : "nunca";
  print("  @" + (a.username || "?"));
  print("      provedor " + (a.provider || "?") + " · saúde " + a.healthStatus
        + " · sessão " + (a.sessionStatus || "-"));
  print("      último login " + quando);
  if (a.lastError) print("      erro: " + String(a.lastError).slice(0, 110));
});

print("");
print("── Token Graph vencendo ──────────────────────");
const limite = new Date(Date.now() + 7 * 864e5);
const vencendo = db.accounts.find(
  { accessToken: { $nin: [null, ""] }, tokenExpiresAt: { $lt: limite } },
  { username: 1, tokenExpiresAt: 1 }
).limit(10).toArray();
if (!vencendo.length) print("  nenhum vence nos próximos 7 dias");
vencendo.forEach(a => print("  @" + a.username + " vence em "
  + (a.tokenExpiresAt ? new Date(a.tokenExpiresAt).toISOString().slice(0, 10) : "?")));
' 2>/dev/null || echo "  (não foi possível consultar o Mongo — o contêiner está de pé?)"

echo
echo "── Últimas falhas de login no serviço Python ─"
# error_type é o campo que separa senha errada de bloqueio disfarçado.
docker compose logs --tail=800 instagrapi-svc 2>/dev/null \
  | grep -Ei "login:|error_type|LOGIN_ROTA|IP_DE_SAIDA|CHALLENGE|RATE_LIMITED" \
  | tail -18 \
  | sed 's/^/  /' \
  || echo "  (sem linhas recentes)"

echo
echo "════════════════════════════════════════════════════════"
echo " Como ler"
echo "════════════════════════════════════════════════════════"
echo "  bad_password + a conta entra no navegador"
echo "      → a conta está SINALIZADA. O Instagram recusa o login por API e"
echo "        não dá o botão \"fui eu\" que existe na web. Use Session ID."
echo
echo "  CHALLENGE_REQUIRED"
echo "      → o Instagram quer confirmação no app. Abra o Instagram no celular,"
echo "        confirme, e conecte de novo em seguida."
echo
echo "  RATE_LIMITED"
echo "      → tentativas demais do mesmo IP. Espere, e confira se cada conta"
echo "        tem proxy próprio: várias contas saindo pelo mesmo IP é o padrão"
echo "        que dispara isso."
echo
echo "  IP_DE_SAIDA diferente entre duas linhas da MESMA conta"
echo "      → o proxy está rotacionando no meio do login. O login são várias"
echo "        requisições em sequência; se o IP muda no meio, o Instagram vê a"
echo "        sessão nascendo espalhada e recusa mesmo com a senha certa."
