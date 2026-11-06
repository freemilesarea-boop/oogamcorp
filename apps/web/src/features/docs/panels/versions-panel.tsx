'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiGet, apiPost, type Paginated } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { docKeys, SNAPSHOT_REASON, type SnapshotItem } from '../api';
import { DocPreview } from '../editor/doc-editor';

/** 버전 기록: 목록 · 미리보기 · 수동 저장 · 복원 */
export function VersionsPanel({ pageId, canEdit, onRestored }: { pageId: string; canEdit: boolean; onRestored: () => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<SnapshotItem | null>(null);
  const list = useQuery({
    queryKey: [...docKeys.versions(pageId), page],
    queryFn: () => apiGet<Paginated<SnapshotItem>>(`/documents/${pageId}/versions`, { page, pageSize: 20 }),
  });
  const detail = useQuery({
    queryKey: docKeys.version(pageId, preview?.id ?? ''),
    queryFn: () => apiGet<SnapshotItem & { content: unknown }>(`/documents/${pageId}/versions/${preview!.id}`),
    enabled: !!preview,
  });
  const snapshot = useMutation({
    mutationFn: () => apiPost(`/documents/${pageId}/versions`),
    onSuccess: () => { toast.success('현재 상태를 버전으로 저장했습니다.'); qc.invalidateQueries({ queryKey: docKeys.versions(pageId) }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const restore = useMutation({
    mutationFn: (sid: string) => apiPost<{ version: number; restoredFrom: number }>(`/documents/${pageId}/versions/${sid}/restore`),
    onSuccess: (r) => {
      toast.success(`버전 ${r.restoredFrom}(으)로 복원했습니다. 복원 전 상태는 버전 기록에 보관됩니다.`);
      setPreview(null);
      qc.invalidateQueries({ queryKey: docKeys.versions(pageId) });
      onRestored();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">편집 중 10분마다 자동으로 버전이 저장됩니다.</p>
        {canEdit && <Button size="sm" variant="outline" onClick={() => snapshot.mutate()} loading={snapshot.isPending}><Save /> 지금 저장</Button>}
      </div>
      {list.isLoading ? <LoadingRows rows={4} /> : list.isError ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? (
        <EmptyState title="저장된 버전이 없습니다" description="문서를 편집하면 버전이 기록됩니다." icon={History} />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.data!.items.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setPreview(s)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{formatDateTime(s.createdAt)}</span>
                    <span className="block truncate text-xs text-muted-foreground">v{s.version} · {s.createdBy?.name ?? '시스템'} · {s.title || '제목 없음'}</span>
                  </span>
                  <Badge variant={s.reason === 'MANUAL' ? 'default' : s.reason === 'RESTORE' ? 'warning' : 'muted'}>{SNAPSHOT_REASON[s.reason]}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={list.data!.totalPages} onChange={setPage} />
        </>
      )}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>버전 미리보기</DialogTitle>
            <DialogDescription>
              {preview && `${formatDateTime(preview.createdAt)} · v${preview.version} · ${SNAPSHOT_REASON[preview.reason]}`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border p-5">
            {detail.isLoading ? <LoadingRows rows={4} /> : detail.isError ? <ErrorState error={detail.error} /> : detail.data && (
              <>
                <h2 className="mb-3 text-2xl font-bold">{detail.data.title || '제목 없음'}</h2>
                <div className="doc-compact-wrap"><DocPreview content={detail.data.content} /></div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>닫기</Button>
            {canEdit && preview && (
              <Button onClick={() => restore.mutate(preview.id)} loading={restore.isPending}><RotateCcw /> 이 버전으로 복원</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
