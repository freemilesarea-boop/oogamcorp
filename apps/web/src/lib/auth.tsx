'use client';
import { useQuery } from '@tanstack/react-query';
import type { PermissionKey } from '@oogam/shared';
import { createContext, useContext } from 'react';
import { apiGet } from './api';

export interface Me {
  user: { id: string; email: string; name: string; avatarUrl: string | null; mfaEnabled: boolean; lastLoginAt: string | null };
  organization: { id: string; name: string; slug: string };
  role: { key: string; name: string };
  title: string | null;
  department: { id: string; name: string } | null;
  permissions: PermissionKey[];
  csrfToken: string;
}

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/auth/me'), staleTime: 60_000 });
}

const MeContext = createContext<Me | null>(null);
export const MeProvider = MeContext.Provider;

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside MeProvider');
  return me;
}

/** UI 표시 여부 판단용. 실제 접근 제어는 서버(API)에서 강제된다. */
export function useCan() {
  const me = useMe();
  const set = new Set(me.permissions);
  return (perm: PermissionKey) => set.has(perm);
}
