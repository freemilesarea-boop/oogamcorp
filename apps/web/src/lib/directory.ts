'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  title: string | null;
  department: { id: string; name: string } | null;
}

/** 담당자·참석자·결재자 선택용 사용자 디렉터리 (GET /directory/users) */
export function useDirectory() {
  return useQuery({ queryKey: ['directory', 'users'], queryFn: () => apiGet<DirectoryUser[]>('/directory/users'), staleTime: 5 * 60_000 });
}

export function useDepartments() {
  return useQuery({ queryKey: ['directory', 'departments'], queryFn: () => apiGet<{ id: string; name: string; parentId: string | null }[]>('/directory/departments'), staleTime: 5 * 60_000 });
}
