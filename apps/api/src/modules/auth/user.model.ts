import { PLAN_IDS, type PlanId } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  plan: PlanId;
  timezone: string;
  status: 'active' | 'suspended';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    plan: { type: String, enum: PLAN_IDS, default: 'free' },
    timezone: { type: String, default: 'America/Sao_Paulo' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastLoginAt: Date,
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });

export const User = model<UserDoc>('User', userSchema);
