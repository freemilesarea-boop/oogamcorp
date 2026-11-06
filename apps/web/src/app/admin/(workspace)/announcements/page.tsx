'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiDelete, apiGet, apiPost, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { ComposeDialog } from '@/features/announcements/compose-dialog';
import { SCOPE_LABELS, type Announcement } from '@/features/announcements/types';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';

type Filter = 'all' | 'unread' | 'mine';

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <AnnouncementsInner />
    </Suspense>
  );
}

function AnnouncementsInner() {
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('id');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [compose, setCompose] = useState<{ editing: Announcement | null } | null>(null);
  const [toDelete, setToDelete] = useState<Announcement | null>(null);

  const list = useQuery({
    queryKey: ['announcements', filter, q, page],
    queryFn: () => apiGet<Paginated<Announcement> & { unreadCount: number }>('/announcements', {
      page, pageSize: 15, q: q || undefined, unread: filter === 'unread' ? 'true' : undefined, mine: filter === 'mine' ? 'true' : undefined,
    }),
    placeholderData: (prev) => prev,
  });
  const setOpen = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set('id', id);
    else sp.delete('id');
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/announcements/${id}`),
    onSuccess: () => { toast.success('공지를 삭제했습니다.'); setOpen(null); void qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <PageHeader
        title="공지"
        description="전사·부서·프로젝트 공지를 확인합니다. 고정 공지가 먼저 표시됩니다."
        actions={can('announcements.write') ? <Button size="sm" onClick={() => setCompose({ editing: null })}><Plus />공지 작성</Button> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setPage(1); }}>
          <TabsList>
            <TabsTrigger noPanel value="all">전체</TabsTrigger>
            <TabsTrigger noPanel value="unread">읽지 않음{list.data && list.data.unreadCount > 0 && filter !== 'unread' ? <span className="tabular-nums font-semibold text-foreground">{list.data.unreadCount}</span> : null}</TabsTrigger>
            {can('announcements.write') && <TabsTrigger noPanel value="mine">내가 쓴 공지</TabsTrigger>}
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="제목·내용 검색" className="pl-8" aria-label="공지 검색" />
        </div>
      </div>
      {list.isLoading ? <LoadingRows rows={6} /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
        <EmptyState icon={Megaphone} title={filter === 'unread' ? '모든 공지를 읽었습니다' : '표시할 공지가 없습니다'} />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {list.data.items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setOpen(a.id)} className={cn('flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none', a.pinned && 'bg-muted/20')}>
                  <span className="mt-1.5 flex w-2 shrink-0 justify-center">{!a.read && <span className="size-2 rounded-full bg-accent" aria-label="읽지 않음" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {a.pinned && <Pin className="size-3.5 shrink-0" aria-label="고정됨" />}
                      <Badge variant="muted">{SCOPE_LABELS[a.scope]}{a.department ? ` · ${a.department.name}` : a.project ? ` · ${a.project.name}` : ''}</Badge>
                      <span className={cn('truncate text-[15px]', !a.read ? 'font-semibold' : 'font-medium')}>{a.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground" title={formatDateTime(a.publishedAt)}>
                      {a.author?.name ?? '알 수 없음'} · {timeAgo(a.publishedAt)}{a.readCount !== undefined ? ` · 읽음 ${a.readCount}` : ''}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={list.data.totalPages} onChange={setPage} />
        </>
      )}

      <AnnouncementDialog
        id={openId}
        onClose={() => setOpen(null)}
        onEdit={(a) => { setOpen(null); setCompose({ editing: a }); }}
        onDelete={(a) => setToDelete(a)}
      />
      <ComposeDialog open={!!compose} onOpenChange={(o) => !o && setCompose(null)} editing={compose?.editing ?? null} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="공지를 삭제할까요?"
        description={toDelete ? `“${toDelete.title}” 공지가 목록에서 사라집니다.` : undefined}
        confirmLabel="삭제"
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete.id); }}
      />
    </>
  );
}

function AnnouncementDialog({ id, onClose, onEdit, onDelete }: { id: string | null; onClose: () => void; onEdit: (a: Announcement) => void; onDelete: (a: Announcement) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['announcements', 'detail', id], queryFn: () => apiGet<Announcement>(`/announcements/${id}`), enabled: !!id });
  const markRead = useMutation({
    mutationFn: (aid: string) => apiPost(`/announcements/${aid}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements'] }),
  });
  const a = q.data;
  useEffect(() => {
    if (a && !a.read && !markRead.isPending) markRead.mutate(a.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.read]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        {q.isLoading ? <LoadingRows rows={4} /> : q.error ? <ErrorState error={q.error} /> : a && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-1.5 pr-6">
                {a.pinned && <Badge variant="default"><Pin className="size-3" />고정</Badge>}
                <Badge variant="muted">{SCOPE_LABELS[a.scope]}{a.department ? ` · ${a.department.name}` : a.project ? ` · ${a.project.key} ${a.project.name}` : ''}</Badge>
              </div>
              <DialogTitle className="text-xl">{a.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex items-center gap-2">
                  <Avatar name={a.author?.name} src={a.author?.avatarUrl} className="size-5" />
                  <span>{a.author?.name ?? '알 수 없음'} · {formatDateTime(a.publishedAt)}</span>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="whitespace-pre-wrap break-words text-[15px] leading-7">{a.body}</div>
            {a.canEdit && (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">{a.readCount !== undefined ? `${a.readCount}명이 읽음` : ''}</span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => onEdit(a)}><Pencil />수정</Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(a)}><Trash2 />삭제</Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
