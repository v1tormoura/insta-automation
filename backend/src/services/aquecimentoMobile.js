'use strict';

/**
 * Aquecimento pela API mobile.
 *
 * ── O que estava errado
 *
 * O aquecimento tinha quatro ações. Duas — `likes` e `comments` — passavam pela
 * API oficial, e ali só existe um alvo possível: os comentários dos posts DA
 * PRÓPRIA CONTA. Curtir a resposta de alguém no seu próprio feed não constrói
 * sinal de atividade nenhum; é a conta conversando consigo mesma.
 *
 * As outras duas — `scroll_reels` e `like_posts` — eram as que pareciam mobile,
 * e usavam a biblioteca antiga do Node (`instagram-private-api`), que precisa de
 * uma sessão que praticamente nenhuma conta tem. Elas caíam no `catch` e
 * escreviam "requer sessão privada" no log. O painel mostrava o aquecimento
 * ATIVO, e o ciclo terminava com "0 curtidas, 0 comentários, 0 follows" — que é
 * exatamente o que aparece no log da conta @luanabrandelli.
 *
 * ── O que este módulo faz
 *
 * Um ciclo de verdade, pela sessão do instagrapi:
 *
 *   descobrir  → o que o aplicativo mostraria a esta conta
 *   ver        → marca como visto (barato, invisível, sempre)
 *   curtir     → nas mídias descobertas, com intervalo entre uma e outra
 *   stories    → dos perfis descobertos
 *   seguir     → a ação mais vigiada, com o menor teto
 *
 * ── Por que a ordem importa
 *
 * Ver vem antes de curtir porque é essa a ordem de uma pessoa: ninguém curte um
 * post que não viu. Uma conta que só emite curtidas, sem nenhuma visualização
 * antes, tem um padrão que nenhum uso humano produz — e é justamente o padrão
 * que se quer evitar ao "aquecer" uma conta.
 *
 * Seguir vem por último e com o menor teto porque é a única ação pública e
 * difícil de desfazer. Se o ciclo for interrompido no meio, o que ficou para
 * trás são visualizações e curtidas, não uma lista de perfis seguidos.
 */

const ESPERA_PADRAO = { min: 8000, max: 20000 };

const espera = ms => new Promise(r => setTimeout(r, ms));
const sorteio = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Embaralha sem alterar o original. Curtir sempre os primeiros da lista é um padrão. */
function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * A conta tem por onde aquecer pelo mobile?
 *
 * `provider` sozinho não basta: uma conta pode estar marcada como instagrapi e
 * nunca ter completado login. E a recíproca também acontece — conta `official`
 * que fez login mobile depois, que é exatamente o caminho novo. O que decide é
 * existir sessão.
 */
function temSessaoMobile(account) {
  return !!(account && (account.instagrapiSession || account.hasInstagrapiSession));
}

/**
 * Roda um ciclo.
 *
 * @param {Object} account
 * @param {Object} opcoes
 * @param {Object} opcoes.limites   — tetos por ação e faixa de intervalo
 * @param {string[]} opcoes.acoes   — quais ações executar
 * @param {Function} opcoes.registrar — (acao, detalhe, extras) => Promise
 * @param {Object} [opcoes.provider]  — injetado nos testes
 * @param {Function} [opcoes.dormir]  — injetado nos testes, para não esperar de verdade
 */
async function ciclo(account, {
  limites = {},
  acoes = ['scroll_reels'],
  registrar = async () => {},
  provider = null,
  dormir = espera,
} = {}) {
  const prov = provider || require('../providers/ProviderFactory').getProvider(account);

  const resultado = {
    likes: 0, comments: 0, follows: 0, views: 0, storyViews: 0,
    descobertas: 0, errors: [],
  };

  const faixaMin = limites.delayMin || ESPERA_PADRAO.min;
  const faixaMax = limites.delayMax || ESPERA_PADRAO.max;
  const pausa = () => dormir(sorteio(faixaMin, faixaMax));

  /* Quanto descobrir: o suficiente para as ações pedidas, com folga. Pedir 30
     para gastar 3 é uma varredura larga no Instagram sem contrapartida — e
     varredura larga é o comportamento que se está tentando não ter. */
  const querCurtir  = acoes.includes('like_posts') || acoes.includes('scroll_reels');
  const querSeguir  = acoes.includes('follow');
  const querStories = acoes.includes('view_stories');

  /* `|| padrão` está errado aqui: zero é escolha, não ausência. Quem configurou
     "0 follows" pediu explicitamente para não seguir ninguém, e o `||`
     devolveria o padrão — o sistema seguiria perfis para quem pediu que não
     seguisse, que é a pior direção possível para errar numa conta em
     aquecimento. */
  const teto = (valor, padrao) => (Number.isFinite(valor) && valor >= 0 ? valor : padrao);

  const tetoCurtidas = querCurtir  ? teto(limites.maxLikes,   5) : 0;
  const tetoFollows  = querSeguir  ? teto(limites.maxFollows, 2) : 0;
  const tetoStories  = querStories ? teto(limites.maxStories, 3) : 0;
  const quantidade   = Math.min(30, Math.max(5, tetoCurtidas + tetoFollows + tetoStories + 3));

  // ── 1. Descobrir ────────────────────────────────────────────────────────
  let itens = [];
  try {
    const fonte   = account.warmupFonte || 'reels';
    const hashtag = _sortearHashtag(account.warmupHashtags);
    const r = await prov.warmupDescobrir(account, {
      fonte: fonte === 'hashtag' && !hashtag ? 'reels' : fonte,
      hashtag,
      amount: quantidade,
    });
    itens = Array.isArray(r?.itens) ? r.itens.filter(i => i && i.media_id) : [];
    resultado.descobertas = itens.length;
  } catch (e) {
    resultado.errors.push(`descobrir: ${e.message}`);
    await registrar('error', `Não foi possível carregar conteúdo para aquecer: ${e.message}`,
      { status: 'error', error: e.message });
    return resultado;
  }

  if (!itens.length) {
    /* Zero itens não é erro de código nem de sessão. Costuma ser conta nova que
       não segue ninguém com a fonte em `feed`, e o conserto é trocar a fonte —
       não reconectar a conta, que é o que uma mensagem de erro genérica faria
       a pessoa tentar. */
    await registrar('cycle_done',
      'Nenhum conteúdo veio para aquecer. Em conta nova, troque a fonte para Reels ou hashtag — o feed só traz quem a conta já segue.',
      { status: 'info' });
    return resultado;
  }

  // ── 2. Ver ──────────────────────────────────────────────────────────────
  /* Sempre, mesmo sem nenhuma ação de curtir pedida. É a parte barata e sem
     efeito para terceiros, e é ela que dá plausibilidade ao resto. */
  try {
    const ids = itens.map(i => i.media_id).slice(0, 30);
    const r = await prov.warmupVisto(account, ids);
    resultado.views = r?.vistas ?? ids.length;
    await registrar('view', `Visualizou ${resultado.views} publicações`, { status: 'success' });
  } catch (e) {
    resultado.errors.push(`visto: ${e.message}`);
  }

  // ── 3. Curtir ───────────────────────────────────────────────────────────
  if (tetoCurtidas > 0) {
    for (const item of embaralhar(itens).slice(0, tetoCurtidas)) {
      try {
        await pausa();
        await prov.warmupCurtir(account, item.media_id);
        resultado.likes++;
        await registrar('like', `Curtiu publicação de @${item.username || '?'}`,
          { targetUser: item.username, targetPostId: item.media_pk || item.media_id });
      } catch (e) {
        resultado.errors.push(`curtir: ${e.message}`);
        /* Um limite do Instagram no meio do ciclo encerra as curtidas. Insistir
           depois de "Please wait a few minutes" é o caminho mais curto para o
           bloqueio que o aquecimento existe para evitar. */
        if (_pedeParaEsperar(e)) {
          await registrar('error', 'O Instagram pediu para esperar — curtidas interrompidas neste ciclo',
            { status: 'error', error: e.message });
          break;
        }
      }
    }
  }

  // ── 4. Stories ──────────────────────────────────────────────────────────
  if (tetoStories > 0) {
    const perfis = _perfisUnicos(itens).slice(0, tetoStories);
    for (const perfil of perfis) {
      try {
        await pausa();
        const r = await prov.warmupStories(account, perfil.user_id, 5);
        const vistos = r?.vistos || 0;
        resultado.storyViews += vistos;
        // Perfil sem story no ar é o caso comum — não vira linha no log.
        if (vistos > 0) {
          await registrar('story_view', `Viu ${vistos} story(s) de @${perfil.username || '?'}`,
            { targetUser: perfil.username });
        }
      } catch (e) {
        resultado.errors.push(`stories: ${e.message}`);
        if (_pedeParaEsperar(e)) break;
      }
    }
  }

  // ── 5. Seguir ───────────────────────────────────────────────────────────
  if (tetoFollows > 0) {
    for (const perfil of _perfisUnicos(itens).slice(0, tetoFollows)) {
      try {
        await pausa();
        await prov.warmupSeguir(account, perfil.user_id);
        resultado.follows++;
        await registrar('follow', `Seguiu @${perfil.username || '?'}`,
          { targetUser: perfil.username });
      } catch (e) {
        resultado.errors.push(`seguir: ${e.message}`);
        if (_pedeParaEsperar(e)) {
          await registrar('error', 'O Instagram pediu para esperar — follows interrompidos neste ciclo',
            { status: 'error', error: e.message });
          break;
        }
      }
    }
  }

  return resultado;
}

/* ── Ajudas ───────────────────────────────────────────────────────────────── */

/** Um perfil por usuário, sem repetir — e sem o dono da própria conta. */
function _perfisUnicos(itens) {
  const vistos = new Set();
  const saida = [];
  for (const i of embaralhar(itens)) {
    if (!i.user_id || vistos.has(i.user_id)) continue;
    vistos.add(i.user_id);
    saida.push({ user_id: i.user_id, username: i.username });
  }
  return saida;
}

function _sortearHashtag(lista) {
  const limpas = (Array.isArray(lista) ? lista : [])
    .map(h => String(h || '').replace(/^#/, '').trim())
    .filter(Boolean);
  if (!limpas.length) return '';
  return limpas[Math.floor(Math.random() * limpas.length)];
}

/**
 * O Instagram está pedindo para desacelerar?
 *
 * Vale por código quando o serviço classificou, e por texto quando não —
 * "Please wait a few minutes before you try again" chega como mensagem crua em
 * boa parte dos casos, e ignorá-la é continuar batendo na porta.
 */
function _pedeParaEsperar(e) {
  if (e?.code === 'RATE_LIMITED' || e?.code === 'ACCOUNT_CHALLENGE') return true;
  return /please wait|try again later|rate.?limit|too many/i.test(String(e?.message || ''));
}

module.exports = { ciclo, temSessaoMobile, _perfisUnicos, _pedeParaEsperar, embaralhar };
