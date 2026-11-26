import type { Request } from 'express';
import type { AuthProvider, UserRole } from '../generated/prisma/client.ts';

export type AuthContext = {
  sessionId: string;
  csrfTokenHash: string;
  csrfTokenEncrypted: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: UserRole;
    unit: { id: string; name: string };
    department: { id: string; name: string };
    authProviders: AuthProvider[];
  };
};

export type AuthenticatedRequest = Request & { authContext?: AuthContext };
