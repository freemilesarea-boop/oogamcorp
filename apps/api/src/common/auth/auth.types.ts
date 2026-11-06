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
  /** MFA 상태: enabled(등록됨), verified(이 세션에서 검증됨), required(역할 정책상 필수) */
  mfa: { enabled: boolean; verified: boolean; required: boolean };
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}
