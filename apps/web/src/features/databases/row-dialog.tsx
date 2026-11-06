'use client';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiGet } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import type { DbMutations } from './api';
import { CellEditor } from './cells';
import { PropIcon } from './prop-icon';
import type { DbProperty, DbRow } from './types';

interface ActivityEntry { id: string; action: string; createdAt: string; actor: { id: string; name: string } | null; changes: Record<string, unknown> | null }
const ACTION_LABEL: Record<string, string> = { 'row.created': '생성', 'row.updated': '수정', 'row.deleted': '삭제' };

/** 행 상세 (모든 속성 편집 + 변경 이력) */
export function RowDialog({ databaseId, rowId, properties, canEdit, mutations, onClose }: {
  databaseId: string;
  rowId: string | null;
  properties: DbProperty[];
  canEdit: boolean;
  mutations: DbMutations;
  onClose: () => void;
}) {
  const row = useQuery({
    queryKey: ['databases', databaseId, 'rows', 'one', rowId],
    enabled: !!rowId,
    queryFn: () => apiGet<DbRow>(`/databases/${databaseId}/rows/${rowId}`),
  });
  const activity = useQuery({
    queryKey: ['databases', databaseId, 'rows', 'activity', rowId],
    enabled: !!rowId,
    queryFn: () => apiGet<ActivityEntry[]>(`/databases/${databaseId}/rows/${rowId}/activity`),
  });
  const title = properties.find((p) => p.type === 'TITLE');
  const others = properties.filter((p) => p.type !== 'TITLE');
  const save = (pid: string, v: unknown) => rowId && mutations.updateCells.mutate({ rowId, cells: { [pid]: v } }, { onSuccess: () => { void row.refetch(); void activity.refetch(); } });

  return (
    <Dialog open={!!rowId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle className="sr-only">행 상세</DialogTitle>
          <DialogDescription className="sr-only">속성 값을 편집하고 변경 이력을 확인합니다.</DialogDescription>
        </DialogHeader>
        {row.isError && <p className="text-sm text-muted-foreground">행을 찾을 수 없거나 삭제되었습니다.</p>}
        {row.data && (
          <div className="space-y-5">
            {title && (
              <div className="text-xl font-semibold [&_button]:text-xl [&_input]:h-9 [&_input]:text-xl">
                <CellEditor prop={title} value={row.data.cells[title.id]} rowId={row.data.id} editable={canEdit} onChange={(v) => save(title.id, v)} />
              </div>
            )}
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_1fr]">
              {others.map((p) => (
                <div key={p.id} className="contents">
                  <dt className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground"><PropIcon type={p.type} />{p.name}</dt>
                  <dd className="min-w-0 text-sm">
                    <CellEditor prop={p} value={row.data.cells[p.id]} rowId={row.data.id} editable={canEdit} onChange={(v) => save(p.id, v)} />
                  </dd>
                </div>
              ))}
            </dl>
            <section aria-labelledby="row-activity" className="border-t border-border pt-4">
              <h3 id="row-activity" className="mb-2 text-sm font-medium">변경 이력</h3>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {(activity.data ?? []).map((a) => (
                  <li key={a.id}>
                    <span className="font-medium text-foreground">{a.actor?.name ?? '시스템'}</span>님이 {ACTION_LABEL[a.action] ?? a.action}
                    {a.action === 'row.updated' && a.changes && <> · {Object.keys(a.changes).filter((k) => k !== 'databaseId').join(', ')}</>}
                    <span className="ml-1">· {timeAgo(a.createdAt)}</span>
                  </li>
                ))}
                {activity.data?.length === 0 && <li>이력이 없습니다.</li>}
              </ul>
            </section>
            {canEdit && (
              <div className="flex justify-end">
                <Button variant="ghost" className="text-danger" onClick={() => {
                  if (!window.confirm('이 행을 삭제할까요?')) return;
                  mutations.deleteRow.mutate(row.data!.id, { onSuccess: onClose });
                }}><Trash2 />행 삭제</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
