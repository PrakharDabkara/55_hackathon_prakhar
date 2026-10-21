import type { Role } from '@askbuy/shared';

export interface User {
  id: string;
  phone: string;
  role: Role;
}

export interface AuthContext {
  user: User;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}
