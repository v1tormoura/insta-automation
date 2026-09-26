import { Schema, model, type Types } from 'mongoose';

/**
 * `state` do OAuth: aleatório, de uso único, com validade curta e amarrado ao
 * usuário que iniciou o fluxo. Guardamos só o hash.
 */
export interface OAuthStateDoc {
  _id: Types.ObjectId;
  stateHash: string;
  userId: Types.ObjectId;
  provider: 'instagram';
  expiresAt: Date;
  consumedAt?: Date;
  /** Resultado do callback, para responder de forma idempotente a um callback repetido. */
  outcome?: { ok: boolean; accountId?: Types.ObjectId; username?: string; error?: string };
  createdAt: Date;
}

const oauthStateSchema = new Schema<OAuthStateDoc>(
  {
    stateHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['instagram'], required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
    outcome: {
      ok: Boolean,
      accountId: { type: Schema.Types.ObjectId },
      username: String,
      error: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
oauthStateSchema.index({ stateHash: 1 }, { unique: true });
// Mantém o registro 1h além do vencimento para reconhecer callbacks duplicados tardios.
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OAuthState = model<OAuthStateDoc>('OAuthState', oauthStateSchema);
