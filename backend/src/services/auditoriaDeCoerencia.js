'use strict';

/**
 * Auditoria de coerência: o que denuncia que várias contas são a mesma mão.
 *
 * ── O que ela procura
 *
 * O Instagram não tem um detector de "robô". Ele mede duas coisas:
 * CORRELAÇÃO (sinais que ligam contas entre si) e INCOERÊNCIA (combinações que
 * um aparelho de verdade não produz). Este módulo mede a primeira, que é a que
 * dá para ver de dentro, sem perguntar nada a ninguém.
 *
 * ── Por que tudo é medido LOCALMENTE
 *
 * Saber o país de um IP exigiria consultar um serviço de geolocalização — ou
 * seja, enviar os endereços de saída dos proxies para um terceiro. Isso é
 * exatamente o tipo de dado que não se manda para fora sem necessidade, e a
 * pergunta mais importante nem precisa disso: contas que compartilham o mesmo
 * IP de saída são detectáveis comparando os campos que já estão gravados.
 *
 * O que depende de geolocalização fica anotado como pendente, para quem quiser
 * checar decidir por conta própria.
 *
 * ── A hierarquia dos achados
 *
 * Nem todo compartilhamento pesa igual, e tratar todos como "problema" faria a
 * lista ser ignorada:
 *
 *   1. MESMO APARELHO + MESMO IP  — é a pior. Duas contas com fingerprint de
 *      hardware idêntico saindo do mesmo endereço não têm como ser duas
 *      pessoas. É a correlação que não tem explicação inocente.
 *   2. MESMO IP                   — várias contas de um endereço acontece na
 *      vida real (família, escritório), mas não em escala.
 *   3. SEM PROXY                  — a conta sai pelo IP do servidor, junto com
 *      todas as outras que também não têm.
 *   4. MESMO APARELHO             — o mais benigno: milhões de pessoas têm o
 *      mesmo celular. Só vira sinal quando soma com o IP.
 */

const Account = require('../models/Account');

/** Sem conexão, o mongoose enfileira a consulta por 10s antes de desistir. */
function bancoConectado() {
  try { return require('mongoose').connection?.readyState === 1; }
  catch { return false; }
}

/** Agrupa por uma chave, devolvendo só os grupos com mais de um membro. */
function repetidos(itens, chave) {
  const mapa = new Map();
  for (const item of itens) {
    const k = chave(item);
    if (k === null || k === undefined || k === '') continue;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(item);
  }
  return [...mapa.entries()]
    .filter(([, membros]) => membros.length > 1)
    .map(([valor, membros]) => ({ valor, contas: membros.map(m => m.username), quantas: membros.length }))
    .sort((a, b) => b.quantas - a.quantas);
}

/**
 * A região configurada, lida do ambiente — os MESMOS nomes que o serviço
 * Python usa em `aplicar_regiao()`.
 *
 * Repetido aqui e não importado porque são processos separados. Os padrões
 * também são os mesmos: mudar num lado sem mudar no outro faria este relatório
 * descrever uma configuração que não é a que está rodando.
 */
function regiaoConfigurada() {
  return {
    pais:   (process.env.INSTAGRAPI_COUNTRY || 'BR').trim().toUpperCase(),
    idioma: (process.env.INSTAGRAPI_LOCALE || 'pt_BR').trim(),
    fusoNome: (process.env.INSTAGRAPI_TZ_NAME || 'America/Sao_Paulo').trim(),
    fusoHoras: Number(process.env.INSTAGRAPI_TZ_OFFSET_HOURS ?? -3),
    /* A região é UMA para todas as contas. Enquanto todas forem do mesmo país
       e saírem por proxies daquele país, está correto. Deixa de estar no dia
       em que uma conta sair por um proxy de outro país: o cliente continuaria
       anunciando este fuso e este idioma. */
    porConta: false,
  };
}

/**
 * Roda a auditoria.
 *
 * Nunca lança: é diagnóstico, e um relatório que derruba a rota que o exibe
 * não serve para diagnosticar nada.
 */
async function auditar() {
  if (!bancoConectado()) {
    return { ok: false, motivo: 'sem banco', regiao: regiaoConfigurada() };
  }

  try {
    /* `proxy` entra no select mas NUNCA sai no relatório: ele carrega
       usuário e senha do fornecedor. O que sai é se existe, e o IP de saída,
       que não é credencial. */
    const contas = await Account.find({ status: { $ne: 'banida' } })
      .select('username deviceIndex proxy proxyIp proxyStatus healthStatus')
      .lean();

    const total = contas.length;
    const semProxy = contas.filter(c => !c.proxy).map(c => c.username);
    const semIpConhecido = contas.filter(c => c.proxy && !c.proxyIp).map(c => c.username);

    /* A pior: mesmo aparelho E mesmo endereço. Só conta quem tem os dois
       conhecidos — juntar `undefined` com `undefined` inventaria uma colisão
       onde só há informação faltando. */
    const comAmbos = contas.filter(c => c.proxyIp && Number.isInteger(c.deviceIndex));
    const aparelhoEip = repetidos(comAmbos, c => `${c.deviceIndex}@${c.proxyIp}`);

    const mesmoIp = repetidos(contas.filter(c => c.proxyIp), c => c.proxyIp);
    const mesmoAparelho = repetidos(
      contas.filter(c => Number.isInteger(c.deviceIndex)), c => String(c.deviceIndex));

    /* Quantas contas por aparelho é a métrica de saturação do pool: passando
       de ~4, vale crescer o catálogo do Python. */
    const aparelhosEmUso = new Set(
      contas.filter(c => Number.isInteger(c.deviceIndex)).map(c => c.deviceIndex)).size;

    return {
      ok: true,
      total,
      regiao: regiaoConfigurada(),

      achados: {
        /* Em ordem de gravidade — ver o cabeçalho do arquivo. */
        aparelhoEip,
        mesmoIp,
        semProxy: { quantas: semProxy.length, contas: semProxy },
        mesmoAparelho,
      },

      pool: {
        aparelhosEmUso,
        contasPorAparelho: aparelhosEmUso ? +(total / aparelhosEmUso).toFixed(1) : 0,
      },

      /* O que esta auditoria NÃO sabe, dito em vez de omitido. Um relatório
         que só lista o que mediu passa a impressão de que o resto está bem. */
      naoVerificado: [
        semIpConhecido.length
          ? `${semIpConhecido.length} conta(s) com proxy mas sem IP de saída detectado — rode o teste de proxy para preencher`
          : null,
        'País e fuso do IP de saída: exigiria consultar um serviço de geolocalização, '
          + 'ou seja, enviar os endereços dos seus proxies para um terceiro. Não é feito aqui.',
        regiaoConfigurada().porConta
          ? null
          : `A região (${regiaoConfigurada().pais}/${regiaoConfigurada().idioma}/${regiaoConfigurada().fusoNome}) `
            + 'é a MESMA para todas as contas. Correto enquanto todos os proxies forem desse país.',
      ].filter(Boolean),
    };
  } catch (err) {
    return { ok: false, motivo: err.message, regiao: regiaoConfigurada() };
  }
}

/** Uma linha por achado, para ler no terminal sem abrir o painel. */
function emTexto(r) {
  if (!r?.ok) return `Auditoria indisponível: ${r?.motivo || 'erro'}`;

  const l = [];
  l.push(`${r.total} conta(s) · região ${r.regiao.pais}/${r.regiao.idioma}/${r.regiao.fusoNome}`);
  l.push(`aparelhos em uso: ${r.pool.aparelhosEmUso} · ${r.pool.contasPorAparelho} conta(s) por aparelho`);
  l.push('');

  const bloco = (titulo, itens, formato) => {
    if (!itens?.length) { l.push(`✓ ${titulo}: nada`); return; }
    l.push(`✗ ${titulo}: ${itens.length}`);
    itens.slice(0, 8).forEach(i => l.push(`    ${formato(i)}`));
    if (itens.length > 8) l.push(`    … e mais ${itens.length - 8}`);
  };

  bloco('mesmo APARELHO e mesmo IP (o pior)', r.achados.aparelhoEip,
    i => `${i.quantas} contas: ${i.contas.join(', ')}`);
  bloco('mesmo IP de saída', r.achados.mesmoIp,
    i => `${i.valor} → ${i.contas.join(', ')}`);

  if (r.achados.semProxy.quantas) {
    l.push(`✗ sem proxy: ${r.achados.semProxy.quantas} — saem pelo IP do servidor`);
  } else {
    l.push('✓ sem proxy: nenhuma');
  }

  bloco('mesmo aparelho (benigno sozinho)', r.achados.mesmoAparelho,
    i => `índice ${i.valor} → ${i.quantas} contas`);

  if (r.naoVerificado.length) {
    l.push('', 'Não verificado:');
    r.naoVerificado.forEach(n => l.push(`  · ${n}`));
  }
  return l.join('\n');
}

module.exports = { auditar, emTexto, regiaoConfigurada, repetidos };
