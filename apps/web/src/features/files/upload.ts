'use client';
import { ApiError, csrfToken } from '@/lib/api';

export interface UploadedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  targetType: string | null;
  targetId: string | null;
  uploadedById: string;
  /** 다운로드 URL (/api/v1/files/<id>/download) — 서버가 요청마다 접근 권한을 확인 */
  url: string;
}

/**
 * 파일 업로드 (multipart/form-data, X-CSRF-Token 첨부).
 * target 지정 시 해당 엔터티(PAGE/TASK/PROJECT/TRANSACTION ...)에 첨부된다.
 */
export async function uploadFile(file: File, target?: { targetType: string; targetId: string }): Promise<UploadedFile> {
  const form = new FormData();
  if (target) {
    form.append('targetType', target.targetType);
    form.append('targetId', target.targetId);
  }
  form.append('file', file, file.name);
  const headers = new Headers();
  const token = csrfToken();
  if (token) headers.set('X-CSRF-Token', token);
  const res = await fetch('/api/v1/files', { method: 'POST', body: form, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | undefined)?.message;
    const fallback = res.status === 413 ? '파일 크기가 허용 한도를 초과했습니다.' : `업로드 실패 (${res.status})`;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('\n') : msg ?? fallback, body);
  }
  return body as UploadedFile;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 업로드 허용 확장자 (서버 정책과 동일 — 최종 검증은 서버) */
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.gif,.webp,.avif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.md,.csv,.zip';
