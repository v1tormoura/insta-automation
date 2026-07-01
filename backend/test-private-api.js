/**
 * Teste de conexão com o Instagram via API privada.
 *
 * Uso:
 *   node test-private-api.js SEU_USUARIO SUA_SENHA
 *
 * O que faz:
 *   1. Tenta login com usuário + senha
 *   2. Busca informações básicas da conta
 *   3. Salva a sessão em test-session.json (para testar reutilização)
 */

const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Uso: node test-private-api.js SEU_USUARIO SUA_SENHA');
  process.exit(1);
}

async function main() {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  // Tenta restaurar sessão salva
  const sessionFile = `test-session-${username}.json`;
  if (fs.existsSync(sessionFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      await ig.state.deserialize(saved);
      const me = await ig.account.currentUser();
      console.log('✅ Sessão restaurada com sucesso!');
      console.log(`   @${me.username} — ${me.full_name}`);
      console.log(`   Seguidores: ${me.follower_count} | Seguindo: ${me.following_count}`);
      console.log('\n✅ API privada funcionando. Pode usar no sistema.');
      return;
    } catch {
      console.log('⚠️  Sessão inválida — fazendo login...');
    }
  }

  // Login
  console.log(`🔑 Fazendo login para @${username}...`);
  try {
    await ig.simulate.preLoginFlow();
    const user = await ig.account.login(username, password);
    process.nextTick(async () => { try { await ig.simulate.postLoginFlow(); } catch {} });

    console.log(`✅ Login OK!`);
    console.log(`   Nome: ${user.full_name}`);
    console.log(`   Seguidores: ${user.follower_count}`);
    console.log(`   Posts: ${user.media_count}`);

    // Salva sessão
    const state = await ig.state.serialize();
    delete state.constants;
    fs.writeFileSync(sessionFile, JSON.stringify(state, null, 2));
    console.log(`\n💾 Sessão salva em ${sessionFile}`);
    console.log('\n✅ Tudo funcionando! O sistema vai usar essa conta sem precisar de browser.');

  } catch (err) {
    if (err.name === 'IgCheckpointError') {
      console.error('\n⚠️  Instagram pediu verificação (checkpoint).');
      console.error('   Abra o app do Instagram no celular e resolva a verificação,');
      console.error('   depois rode o teste novamente.');
    } else if (err.name === 'IgLoginBadPasswordError') {
      console.error('\n❌ Senha incorreta.');
    } else if (err.name === 'IgLoginInvalidUserError') {
      console.error('\n❌ Usuário não encontrado.');
    } else {
      console.error('\n❌ Erro:', err.message);
      console.error('   Nome do erro:', err.name);
    }
    process.exit(1);
  }
}

main();
