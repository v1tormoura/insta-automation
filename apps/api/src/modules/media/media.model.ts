import { MEDIA_KINDS, type MediaKind } from '@nexora/shared';
import { Schema, model, type Types } from 'mongoose';
import { tenantGuard } from '../../infra/tenantGuard.js';

export interface MediaDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: MediaKind;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  videoCodec?: string | null;
  storageKey: string;
  thumbnailKey?: string | null;
  checksum: string;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<MediaDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: MEDIA_KINDS, required: true },
    mimeType: { type: String, required: true },
    originalName: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: Number,
    height: Number,
    durationSeconds: Number,
    videoCodec: String,
    storageKey: { type: String, required: true },
    thumbnailKey: String,
    checksum: { type: String, required: true },
    deletedAt: Date,
  },
  { timestamps: true },
);
mediaSchema.index({ userId: 1, createdAt: -1 });
mediaSchema.index({ userId: 1, checksum: 1 });
mediaSchema.plugin(tenantGuard);

export const Media = model<MediaDoc>('Media', mediaSchema, 'media');
