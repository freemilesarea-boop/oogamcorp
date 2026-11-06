import type { PermissionKey } from '@oogam/shared';
import type { Request } from 'express';

export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  email: string;
  name: string;
  roleKey: string;
  roleRank: number;
  departmentId: string | null;
  permissions: Set<PermissionKey>;
  csrfToken: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}
