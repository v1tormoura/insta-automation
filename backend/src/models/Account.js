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

    lastHealthCheck: {
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
      enum: ['ativa', 'restrita', 'erro_login', 'sessao_expirada', 'banida', 'token_invalido', 'conta_pessoal'],
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

    // sessionid bruto extraído do browser via 🍪 — não é apagado pelo keepAlive
    rawWebSessionid: {
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

    // Segredo TOTP do Google Authenticator (gerado no setup do 2FA)
    // Formato: base32 string, ex: "JBSWY3DPEHPK3PXP"
    // Usado para gerar códigos 2FA automaticamente sem interação manual
    totpSecret: {
      type: String,
      default: '',
    },

    accountType: {
      type: String,
      default: '',
    },

    // ─── Aquecimento ──────────────────────────────────────────────────────
    warmupActive: { type: Boolean, default: false },
    warmupIntensity: { type: String, default: 'leve' },
    warmupActions: { type: [String], default: [] },
    warmupInterval: { type: Number, default: 30 },
    warmupMaxLikes: { type: Number, default: 6 },
    warmupMaxComments: { type: Number, default: 2 },
    warmupMaxFollows: { type: Number, default: 4 },
    warmupComments: { type: [String], default: [] },

    // ─── Divulgação automática (Promo) ───────────────────────────────────
    promoEnabled:        { type: Boolean, default: false },
    promoLink:           { type: String,  default: '' },
    autoComment:         { type: Boolean, default: true  },
    autoCommentTemplate: { type: String,  default: '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}' },
    autoStory:           { type: Boolean, default: false },
    autoBio:             { type: Boolean, default: false },
    lastPromoAt:         { type: Date,    default: null  },
  },
  {
    timestamps: true,
  }
);

accountSchema.index({ isBusy: 1, busySince: 1 });
accountSchema.index({ healthStatus: 1 });

// ─── Token encryption (transparent) ──────────────────────────────────────────
// Getter decrypts on read; setter encrypts on write.
// Plaintext tokens pass through unchanged (backward compatible).
// Without ENCRYPTION_KEY: no-op — tokens stored as plaintext.

const { encrypt: _encryptToken, decrypt: _decryptToken } = require('../services/tokenEncryption');

accountSchema.path('accessToken')
  .get(function (v) { try { return _decryptToken(v); } catch { return v; } })
  .set(function (v) { try { return _encryptToken(v); } catch { return v; } });

// findByIdAndUpdate / updateOne bypass path setters → encrypt here
accountSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function (next) {
  const u = this.getUpdate();
  const raw = u?.accessToken ?? u?.$set?.accessToken;
  if (raw && typeof raw === 'string') {
    try {
      const enc = _encryptToken(raw);
      if (u.accessToken !== undefined)      u.accessToken      = enc;
      if (u.$set?.accessToken !== undefined) u.$set.accessToken = enc;
    } catch { /* leave as-is on error */ }
  }
  next();
});

// Ensure getters run on toObject / toJSON calls used by controllers
accountSchema.set('toObject', { getters: true });
accountSchema.set('toJSON',   { getters: true });

module.exports = mongoose.model('Account', accountSchema);
