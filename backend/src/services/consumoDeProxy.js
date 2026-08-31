'use strict';

/**
 * Consumo do proxy — quanto se gasta por dia, e quando a cota acaba.
 *
 * ── O problema que isto resolve
 *
 * A cota acabou sem aviso porque ninguém a estava medindo. Não havia painel,
 * número nem tendência: a primeira notícia foi o serviço parar, e aí já eram
 * quatro dias e meio de produto fora do ar.
 *
 * ── A honestidade do método
 *
 * Bytes seria a medida certa e não temos como obtê-la — o tráfego sai de
 * dentro do instagrapi, que não expõe tamanho de resposta, e o fornecedor não
 * publica API de consumo.
 *
 * Então o sistema conta OPERAÇÕES, que ele sabe contar com exatidão, e aprende
 * a conversão para gigabytes com você: sempre que registrar quanto o painel do
 * fornecedor marca, ele divide pela contagem acumulada e passa a saber quanto
 * custa cada operação. Da segunda leitura em diante, projeta sozinho.
 *
 * Inventar um número de bytes por operação daria uma projeção convincente e
 * errada. Uma projeção errada sobre quando o serviço vai parar é pior que
 * nenhuma, porque ela é confiada.
 */

const CHAVE_PLANO = 'proxyPlano';

function bancoConectado() {
  try { return require('mongoose').connection?.readyState === 1; }
  catch { return false; }
}

/** `YYYY-MM-DD` local — o dia como a pessoa o entende, não em UTC. */
function hoje(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Conta uma operação que saiu pelo proxy.
 *
 * Chamado de `resolverComOrigem`, que é o funil por onde toda saída passa —
 * publicação, sincronização, login e health check. Registrar em cada consumidor
 * seria quatro chances de esquecer um, com o sintoma de a projeção ficar
 * otimista sem ninguém entender por quê.
 *
 * Não usa `await` em quem chama e engole o próprio erro: contabilidade não pode
 * atrasar nem derrubar uma publicação.
 */
async function registrar(origem) {
  if (!module.exports.bancoConectado()) return;
  if (!['conta', 'pool', 'global'].includes(origem)) return;

  const ProxyUso = require('../models/ProxyUso');
  await ProxyUso.updateOne(
    { dia: hoje() },
    { $inc: { operacoes: 1, [`porOrigem.${origem}`]: 1 } },
    { upsert: true }
  ).catch(() => { /* contabilidade não derruba operação */ });
}

/** O plano informado por você: total contratado e a última leitura do painel. */
async function lerPlano() {
  if (!module.exports.bancoConectado()) return null;
  const Setting = require('../models/Setting');
  const doc = await Setting.findOne({ key: CHAVE_PLANO }).lean().catch(() => null);
  return doc?.value || null;
}

async function gravarPlano(plano) {
  const Setting = require('../models/Setting');
  const atual = (await lerPlano()) || {};

  /* Cada leitura do painel vira uma MARCA: consumo informado + operações
     acumuladas naquele instante. Duas marcas dão a conversão; as seguintes a
     refinam. Guardar só a última impediria calcular qualquer taxa. */
  const marcas = Array.isArray(atual.marcas) ? atual.marcas.slice(-11) : [];
  if (typeof plano.usadoGb === 'number') {
    marcas.push({ em: new Date().toISOString(), usadoGb: plano.usadoGb, operacoes: await totalDeOperacoes() });
  }

  const valor = {
    totalGb:  typeof plano.totalGb === 'number' ? plano.totalGb : atual.totalGb || 0,
    renovaEm: plano.renovaEm || atual.renovaEm || '',
    marcas,
  };
  await Setting.updateOne({ key: CHAVE_PLANO }, { $set: { value: valor } }, { upsert: true });
  return valor;
}

async function totalDeOperacoes() {
  const ProxyUso = require('../models/ProxyUso');
  const r = await ProxyUso.aggregate([{ $group: { _id: null, n: { $sum: '$operacoes' } } }]).catch(() => []);
  return r[0]?.n || 0;
}

/** Operações por dia nos últimos N dias, do mais antigo para o mais novo. */
async function serie(dias = 14) {
  if (!module.exports.bancoConectado()) return [];
  const ProxyUso = require('../models/ProxyUso');
  const limite = new Date(Date.now() - dias * 864e5);
  return ProxyUso.find({ dia: { $gte: hoje(limite) } }).sort({ dia: 1 }).lean().catch(() => []);
}

/**
 * Projeção: quanto falta e quantos dias isso dá.
 *
 * Devolve `{ conhecido: false }` enquanto não houver duas leituras — e essa é a
 * resposta certa nesse estado. Um número aqui sem base seria adivinhação com
 * cara de medição.
 */
async function projetar() {
  const plano = await lerPlano();
  const marcas = plano?.marcas || [];
  if (!plano?.totalGb || marcas.length < 2) {
    return {
      conhecido: false,
      motivo: marcas.length < 2
        ? 'Registre o consumo do painel do fornecedor duas vezes para a projeção começar.'
        : 'Informe o total contratado do plano.',
      totalGb: plano?.totalGb || 0,
      leituras: marcas.length,
    };
  }

  const primeira = marcas[0];
  const ultima = marcas[marcas.length - 1];
  const gastoGb = ultima.usadoGb - primeira.usadoGb;
  const operacoes = ultima.operacoes - primeira.operacoes;

  if (gastoGb <= 0 || operacoes <= 0) {
    return { conhecido: false, motivo: 'As duas leituras não mostram consumo entre elas.', totalGb: plano.totalGb };
  }

  const gbPorOperacao = gastoGb / operacoes;
  const restanteGb = Math.max(0, plano.totalGb - ultima.usadoGb);

  /* O ritmo vem dos últimos sete dias, não da média histórica: uma semana
     parada no começo do mês faria a média mentir para baixo justamente quando
     o consumo está alto. */
  const ultimos = await serie(7);
  const porDia = ultimos.length
    ? ultimos.reduce((s, d) => s + (d.operacoes || 0), 0) / ultimos.length
    : 0;

  const diasRestantes = porDia > 0 && gbPorOperacao > 0
    ? Math.floor(restanteGb / (porDia * gbPorOperacao))
    : null;

  return {
    conhecido: true,
    totalGb: plano.totalGb,
    usadoGb: ultima.usadoGb,
    restanteGb: Number(restanteGb.toFixed(2)),
    percentualUsado: Math.round((ultima.usadoGb / plano.totalGb) * 100),
    mbPorOperacao: Number((gbPorOperacao * 1024).toFixed(2)),
    operacoesPorDia: Math.round(porDia),
    diasRestantes,
    renovaEm: plano.renovaEm || '',
    leituras: marcas.length,
  };
}

module.exports = {
  registrar, lerPlano, gravarPlano, serie, projetar, totalDeOperacoes,
  bancoConectado, hoje, CHAVE_PLANO,
};
