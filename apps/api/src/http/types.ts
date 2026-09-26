import type { Types } from 'mongoose';
import type { UserDoc } from '../modules/auth/user.model.js';

export interface AuthContext {
  userId: Types.ObjectId;
  user: UserDoc;
  sessionId: Types.ObjectId;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
