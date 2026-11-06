'use client';
import type { JSONContent } from '@tiptap/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, csrfToken, ApiError, type Paginated } from '@/lib/api';

export type AccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL';
export type Visibility = 'WORKSPACE' | 'PRIVATE' | 'RESTRICTED';
export interface UserLite { id: string; name: string; email: string; avatarUrl: string | null }

export interface TreeNode {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  position: number;
  visibility: Visibility;
  access: AccessLevel;
  updatedAt: string;
  children: TreeNode[];
}

/** Tiptap(ProseMirror) JSON 문서 */
export type DocJson = JSONContent;

export interface DocumentDetail {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  content: DocJson | null;
  isTemplate: boolean;
  visibility: Visibility;
  version: number;
  access: AccessLevel;
  createdAt: string;
  updatedAt: string;
  createdBy: UserLite | null;
  updatedBy: UserLite | null;
  workspace: { id: string; name: string; icon: string | null } | null;
  breadcrumbs: { id: string; title: string; icon: string | null }[];
  childCount: number;
  hasYState: boolean;
}

export interface DocListItem {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  isTemplate: boolean;
  visibility: Visibility;
  updatedAt: string;
  createdAt: string;
  access: AccessLevel | null;
  updatedBy: UserLite | null;
  snippet: string;
  path: string[];
}

export interface TrashItem {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: string;
  deletedBy: UserLite | null;
  descendants: number;
  canPurge: boolean;
}

export interface SnapshotItem {
  id: string;
  version: number;
  title: string;
  reason: 'MANUAL' | 'AUTO' | 'RESTORE' | 'COLLAB';
  createdAt: string;
  createdBy: UserLite | null;
}

export interface CommentItem {
  id: string;
  parentId: string | null;
  body: string;
  deleted: boolean;
  author: UserLite | null;
  mentions: UserLite[];
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  canEdit: boolean;
  canDelete: boolean;
  replies?: CommentItem[];
}

export interface AccessInfo {
  visibility: Visibility;
  access: AccessLevel;
  owner: UserLite | null;
  grants: { id: string; access: AccessLevel; expiresAt: string | null; createdAt: string; user: UserLite | null; department: { id: string; name: string } | null }[];
}

export const LEVEL_RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };
export const atLeast = (lvl: AccessLevel | null | undefined, need: AccessLevel) => !!lvl && LEVEL_RANK[lvl] >= LEVEL_RANK[need];

export const ACCESS_LABEL: Record<AccessLevel, string> = { VIEW: '보기', COMMENT: '댓글', EDIT: '편집', FULL: '전체 권한' };
export const VISIBILITY_LABEL: Record<Visibility, { label: string; description: string }> = {
  WORKSPACE: { label: '워크스페이스', description: '워크스페이스 구성원 누구나 볼 수 있고, 문서 작성 권한이 있으면 편집할 수 있습니다.' },
  RESTRICTED: { label: '제한됨', description: '아래에 추가한 사용자·부서만 접근할 수 있습니다.' },
  PRIVATE: { label: '비공개', description: '작성자(및 명시적으로 추가한 사용자)만 접근할 수 있습니다.' },
};
export const SNAPSHOT_REASON: Record<SnapshotItem['reason'], string> = { MANUAL: '수동 저장', AUTO: '자동 저장', RESTORE: '복원 전 백업', COLLAB: '공동 편집' };

export const docKeys = {
  tree: ['docs', 'tree'] as const,
  doc: (id: string) => ['docs', 'doc', id] as const,
  search: (params: object) => ['docs', 'search', params] as const,
  templates: ['docs', 'templates'] as const,
  trash: (page: number) => ['docs', 'trash', page] as const,
  versions: (id: string) => ['docs', 'versions', id] as const,
  version: (id: string, sid: string) => ['docs', 'version', id, sid] as const,
  access: (id: string) => ['docs', 'access', id] as const,
  comments: (id: string) => ['comments', 'PAGE', id] as const,
};

export function useDocTree() {
  return useQuery({
    queryKey: docKeys.tree,
    queryFn: () => apiGet<{ workspace: { id: string; name: string; icon: string | null }; items: TreeNode[] }>('/documents/tree'),
  });
}

export function useDocument(id: string) {
  return useQuery({ queryKey: docKeys.doc(id), queryFn: () => apiGet<DocumentDetail>(`/documents/${id}`), retry: (n, e) => !(e instanceof ApiError && [403, 404].includes(e.status)) && n < 2 });
}

export function useDocSearch(params: { q?: string; page?: number; pageSize?: number; sort?: string }, enabled = true) {
  return useQuery({
    queryKey: docKeys.search(params),
    queryFn: () => apiGet<Paginated<DocListItem>>('/documents', { ...params, templates: 'false' }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTemplates() {
  return useQuery({ queryKey: docKeys.templates, queryFn: () => apiGet<Paginated<DocListItem>>('/documents/templates', { pageSize: 50 }) });
}

export function useTrash(page: number, enabled = true) {
  return useQuery({ queryKey: docKeys.trash(page), queryFn: () => apiGet<Paginated<TrashItem>>('/documents/trash', { page, pageSize: 20 }), enabled });
}

/** 문서 목록 계열 쿼리 무효화 (트리/검색/템플릿/휴지통) */
export function useInvalidateDocs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'docs' && q.queryKey[1] !== 'doc' });
}

export function useCreateDocument() {
  const invalidate = useInvalidateDocs();
  return useMutation({
    mutationFn: (body: { title?: string; parentId?: string; icon?: string; templateId?: string; isTemplate?: boolean; visibility?: Visibility }) =>
      apiPost<{ id: string }>('/documents', body),
    onSuccess: () => invalidate(),
  });
}

export function useMoveDocument() {
  const invalidate = useInvalidateDocs();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; parentId?: string | null; beforeId?: string; afterId?: string }) => apiPost(`/documents/${id}/move`, body),
    onSettled: () => invalidate(),
  });
}

export function useDocActions() {
  const invalidate = useInvalidateDocs();
  const qc = useQueryClient();
  return {
    duplicate: useMutation({
      mutationFn: ({ id, includeChildren }: { id: string; includeChildren: boolean }) => apiPost<{ id: string; count: number }>(`/documents/${id}/duplicate`, { includeChildren }),
      onSuccess: () => invalidate(),
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiDelete<{ count: number }>(`/documents/${id}`),
      onSuccess: (_d, id) => { invalidate(); qc.removeQueries({ queryKey: docKeys.doc(id) }); },
    }),
    restore: useMutation({ mutationFn: (id: string) => apiPost<{ count: number; movedToRoot: boolean }>(`/documents/${id}/restore`), onSuccess: () => invalidate() }),
    purge: useMutation({ mutationFn: (id: string) => apiDelete(`/documents/${id}/permanent`), onSuccess: () => invalidate() }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; title?: string; icon?: string | null; isTemplate?: boolean }) => apiPatch(`/documents/${id}`, body),
      onSuccess: (_d, v) => { invalidate(); qc.invalidateQueries({ queryKey: docKeys.doc(v.id) }); },
    }),
  };
}

export interface UploadedFile { id: string; originalName: string; mimeType: string; size: number; url: string }

/** 파일 업로드 (POST /files, multipart). 문서에 연결해 접근 제어를 따르도록 targetType/targetId 지정 */
export async function uploadFile(file: File, pageId: string): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('targetType', 'PAGE');
  fd.append('targetId', pageId);
  const headers = new Headers();
  const t = csrfToken();
  if (t) headers.set('X-CSRF-Token', t);
  const res = await fetch('/api/v1/files', { method: 'POST', body: fd, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('\n') : msg ?? (res.status === 404 ? '파일 업로드 API 를 사용할 수 없습니다.' : `업로드 실패 (${res.status})`), body);
  }
  return body as UploadedFile;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
