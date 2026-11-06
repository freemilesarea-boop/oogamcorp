'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiDelete, apiGet, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';
import { FileIcon } from '@/features/files/file-icon';
import { formatBytes, type UploadedFile } from '@/features/files/upload';
import { UploadZone } from '@/features/files/upload-zone';

const TARGET_LABELS: Record<string, string> = {
  PAGE: '문서', TASK: '업무', PROJECT: '프로젝트', APPROVAL: '결재', TRANSACTION: '거래', BUDGET: '예산', DATABASE_ROW: 'DB 항목', EVENT: '일정', ANNOUNCEMENT: '공지',
};

type FileRow = UploadedFile & { uploadedBy: { id: string; name: string } | null; canDelete: boolean };

export default function FilesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [toDelete, setToDelete] = useState<FileRow | null>(null);
  const query = useQuery({
    queryKey: ['files', 'mine', page, q],
    queryFn: () => apiGet<Paginated<FileRow>>('/files', { page, pageSize: 20, q: q || undefined }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/files/${id}`),
    onSuccess: () => {
      toast.success('파일을 삭제했습니다.');
      void qc.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <PageHeader title="파일" description="내가 업로드한 파일. 다운로드할 때마다 서버가 접근 권한을 다시 확인합니다." />
      {can('files.write') && (
        <UploadZone className="mb-6" onUploaded={() => void qc.invalidateQueries({ queryKey: ['files'] })} />
      )}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="파일명 검색" className="pl-8" aria-label="파일명 검색" />
        </div>
        {query.data && <span className="text-sm text-muted-foreground tabular-nums">총 {query.data.total}개</span>}
      </div>
      {query.isLoading ? <LoadingRows /> : query.error ? <ErrorState error={query.error} /> : !query.data?.items.length ? (
        <EmptyState title={q ? '검색 결과가 없습니다' : '업로드한 파일이 없습니다'} description="문서·업무·결재에 첨부한 파일도 여기에서 모아 볼 수 있습니다." />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>파일명</TH>
                <TH className="hidden md:table-cell">연결</TH>
                <TH className="text-right">크기</TH>
                <TH className="hidden sm:table-cell">업로드</TH>
                <TH className="w-24"><span className="sr-only">작업</span></TH>
              </TR>
            </THead>
            <TBody>
              {query.data.items.map((f) => (
                <TR key={f.id}>
                  <TD>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileIcon mimeType={f.mimeType} className="size-4 shrink-0 text-muted-foreground" />
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="truncate font-medium hover:underline">{f.originalName}</a>
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {f.targetType ? <Badge variant="muted">{TARGET_LABELS[f.targetType] ?? f.targetType}</Badge> : <span className="text-muted-foreground">-</span>}
                  </TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{formatBytes(f.size)}</TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{formatDateTime(f.createdAt)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`${f.originalName} 다운로드`}>
                        <a href={f.url} download><Download /></a>
                      </Button>
                      {f.canDelete && can('files.write') && (
                        <Button variant="ghost" size="icon-sm" aria-label={`${f.originalName} 삭제`} onClick={() => setToDelete(f)}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={query.data.totalPages} onChange={setPage} />
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="파일을 삭제할까요?"
        description={toDelete ? `“${toDelete.originalName}” 파일이 삭제되며, 연결된 문서·업무에서도 더 이상 열 수 없습니다.` : undefined}
        confirmLabel="삭제"
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete.id); }}
      />
    </>
  );
}
