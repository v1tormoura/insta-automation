const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    username: String,

    name: {
      type: String,
      default: '',
    },

    avatar: {
      type: String,
      default: '',
    },

    followers: {
      type: Number,
      default: 0,
    },

    following: {
      type: Number,
      default: 0,
    },

    postsCount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      default: 'ativa',
    },

    bio: {
      type: String,
      default: '',
    },

    externalLink: {
      type: String,
      default: '',
    },

    proxy: {
      type: String,
      default: '',
    },
    
    proxyStatus: {
      type: String,
      default: 'nao_testado',
    },

    proxyLastCheck: {
      type: Date,
      default: null,
    },

    lastSync: {
      type: Date,
      default: null,
    },

    // 🔥 CONTROLE DE POSTAGEM

    dailyPostLimit: {
      type: Number,
      default: 999999,
    },

    postsToday: {
      type: Number,
      default: 0,
    },

    lastPostDate: {
      type: Date,
      default: null,
    },

    lastPostAt: {
      type: Date,
      default: null,
    },

    // 🔥 SAÚDE DA CONTA

    healthStatus: {
      type: String,
      enum: ['ativa', 'restrita', 'erro_login', 'sessao_expirada', 'banida'],
      default: 'ativa',
    },

    lastError: {
      type: String,
      default: '',
    },
    isBusy: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      default: '',
    },

    // Email ou telefone usado para login (quando username não funciona na API privada)
    loginEmail: {
      type: String,
      default: '',
    },
    busySince: {
      type: Date,
      default: null,
    },

    busyReason: {
      type: String,
      default: '',
    },

    // ─── Private Instagram API (instagram-private-api) ───────────────────
    // igSession — serialized session state (login once, reuse for all posts)
    // Cleared automatically on session errors; re-login happens transparently.

    igSession: {
      type: String,
      default: '',
    },

    // ─── Meta Graph API ───────────────────────────────────────────────────
    // igUserId      — numeric Instagram User ID (e.g. "17841400000000001")
    // accessToken   — long-lived user access token (valid ~60 days)
    // tokenExpiresAt — when the token expires (for refresh reminders)

    igUserId: {
      type: String,
      default: '',
    },

    accessToken: {
      type: String,
      default: '',
    },

    tokenExpiresAt: {
      type: Date,
      default: null,
    },


    // profileId do Multilogin para auto-sync de cookies sem ação manual
    multiloginProfileId: {
      type: String,
      default: '',
    },

    // Última vez que o keepalive da sessão foi executado
    lastSessionKeepAlive: {
      type: Date,
      default: null,
    },

    // Estado serializado do ig client durante challenge pendente (persiste reinicializações)
    challengeState: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Account', accountSchema);
