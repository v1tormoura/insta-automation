'use strict';
const mongoose = require('mongoose');

/**
 * O dono do painel.
 *
 * ── Por que este modelo não existia
 *
 * A autenticação é uma senha só, lida de `AUTH_PASSWORD` no ambiente. Funciona,
 * e por isso nunca houve um usuário guardado em lugar nenhum: não havia nome,
 * nem e-mail, nem foto, nem como trocar a senha sem editar o `.env` e reiniciar
 * o backend.
 *
 * ── Por que é um documento único, e não uma coleção de usuários
 *
 * O produto é de uma pessoa. Uma coleção de usuários pediria papéis, convites,
 * escopo por usuário em cada consulta — e nada disso tem dono para usar. Um
 * documento com `chave: 'principal'` e índice único é o que existe hoje,
 * explícito, e abre a porta para mais de um sem prometer que já suporta.
 *
 * ── Por que a senha do ambiente continua valendo
 *
 * Se o hash daqui fosse a única forma de entrar, um banco fora do ar trancaria
 * a pessoa fora do próprio painel — e o painel é justamente onde ela iria ver
 * que o banco está fora. `AUTH_PASSWORD` fica como chave de recuperação:
 * aceita SÓ quando não há hash gravado, ou quando o banco não responde. As
 * duas exceções são registradas no log, porque uma entrada por caminho
 * alternativo é o tipo de coisa que se precisa poder auditar depois.
 *
 * Isso é dito na tela, com essas palavras. Uma troca de senha que deixa a
 * antiga funcionando sem avisar é pior que não trocar.
 */
const usuarioSchema = new mongoose.Schema({
  /* Sempre 'principal'. O índice único é o que garante um documento só —
     sem ele, dois `upsert` concorrentes criariam dois donos do painel. */
  chave: { type: String, default: 'principal', unique: true },

  nome:  { type: String, default: '' },
  email: { type: String, default: '' },

  /* Caminho público versionado (`/uploads/...?v=`), como o avatar das contas.
     Ver o comentário em avatarLocal.js sobre por que a versão importa. */
  avatar: { type: String, default: '' },

  /* `scrypt$...`, nunca a senha. Ver senhaDoPainel.js.
     `select: false`: uma consulta distraída não pode devolver o hash na
     resposta de uma rota — e a rota que precisa dele pede explicitamente. */
  senhaHash: { type: String, default: '', select: false },
  senhaTrocadaEm: { type: Date, default: null },

  preferencias: {
    /* 'escuro' | 'claro'. O tema claro já existia no CSS, medido pelo teste de
       contraste, e não tinha como ser ligado — nada no app escrevia
       `data-tema`. */
    tema:   { type: String, default: 'escuro' },
    /* 'pt' | 'en' | 'es'. Guardado, e ainda sem efeito: não existe tradução
       no produto. A tela diz isso em vez de fingir. */
    idioma: { type: String, default: 'pt' },
    fundoAnimado: { type: Boolean, default: true },
  },

  /* Privacidade do aviso que aparece na tela de bloqueio do celular, onde
     qualquer um que olhe o aparelho lê. Desligar troca o dado pelo genérico
     na hora de montar a mensagem — não é um enfeite de interface. */
  notificacoes: {
    mostrarNome:  { type: Boolean, default: true },
    mostrarValor: { type: Boolean, default: true },
  },
}, { timestamps: true });

module.exports = mongoose.model('Usuario', usuarioSchema);
