'use client';
import { useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { apiGet } from '@/lib/api';

export interface FileItem { id: string; originalName: string; mimeType: string; size: number; url?: string }

/** 공용 파일 API 목록 (GET /files?targetType=&targetId=). 응답 형태(배열/페이지) 모두 수용 */
export function useTargetFiles(targetType: 'APPROVAL' | 'TRANSACTION', targetId: string | null | undefined) {
  return useQuery({
    queryKey: ['files', targetType, targetId],
    queryFn: async () => {
      const d = await apiGet<{ items: FileItem[] } | FileItem[]>('/files', { targetType, targetId: targetId ?? undefined });
      return Array.isArray(d) ? d : d?.items ?? [];
    },
    enabled: !!targetId,
    retry: false,
  });
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 파일 링크: 파일 API 가 제공하는 url 이 있으면 링크, 없으면 이름만 표시 */
export function FileLink({ file, url }: { file: { id: string; originalName: string; size?: number }; url?: string }) {
  const content = (
    <>
      <Paperclip className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{file.originalName}</span>
      {file.size != null && <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>}
    </>
  );
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 underline-offset-2 hover:underline">{content}</a>
    : <span className="inline-flex max-w-full items-center gap-1.5">{content}</span>;
}
