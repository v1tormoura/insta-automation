import { Schema, model, type Types } from 'mongoose';

/**
 * Sessão opaca: o cookie carrega um token aleatório, o banco guarda só o hash.
 * Vazou o banco, não vazou sessão. Logout e "sair de todos" são um delete.
 */
export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    userAgent: String,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<SessionDoc>('Session', sessionSchema);
