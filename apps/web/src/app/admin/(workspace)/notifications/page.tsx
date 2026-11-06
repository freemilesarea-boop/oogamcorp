'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, CheckCheck, CheckSquare, Clock, Megaphone, MessageSquare, Stamp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiDelete, apiGet, apiPost, type Paginated } from '@/lib/api';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const TYPES: Record<string, { label: string; icon: typeof Bell }> = {
  MENTION: { label: '멘션', icon: AtSign },
  TASK_ASSIGNED: { label: '업무 배정', icon: CheckSquare },
  TASK_DUE: { label: '마감 임박', icon: Clock },
  APPROVAL_REQUESTED: { label: '결재 요청', icon: Stamp },
  APPROVAL_COMPLETED: { label: '결재 완료', icon: Stamp },
  APPROVAL_CHANGES_REQUESTED: { label: '보완 요청', icon: Stamp },
  ANNOUNCEMENT: { label: '공지', icon: Megaphone },
  COMMENT: { label: '댓글', icon: MessageSquare },
  SYSTEM: { label: '시스템', icon: Bell },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['notifications', 'page', tab, type, page],
    queryFn: () => apiGet<Paginated<Notification>>('/notifications', { page, pageSize: 25, unread: tab === 'unread' ? 'true' : undefined, type: type || undefined }),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => apiPost(`/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({
    mutationFn: () => apiPost<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => { toast.success(`${r.updated}개 알림을 읽음 처리했습니다.`); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/notifications/${id}`), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });

  return (
    <>
      <PageHeader
        title="알림"
        description="업무 배정, 결재, 멘션, 공지 알림을 한 곳에서 확인합니다."
        actions={<Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}><CheckCheck />모두 읽음</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as 'all' | 'unread'); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">전체</TabsTrigger>
            <TabsTrigger value="unread">읽지 않음</TabsTrigger>
          </TabsList>
        </Tabs>
        <NativeSelect value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-40" aria-label="알림 유형">
          <option value="">모든 유형</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </NativeSelect>
      </div>
      {list.isLoading ? <LoadingRows rows={8} /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
        <EmptyState icon={Bell} title={tab === 'unread' ? '읽지 않은 알림이 없습니다' : '알림이 없습니다'} />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {list.data.items.map((n) => {
              const meta = TYPES[n.type] ?? TYPES.SYSTEM;
              const Icon = meta.icon;
              const content = (
                <>
                  <p className={cn('truncate text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground" title={formatDateTime(n.createdAt)}>{meta.label} · {timeAgo(n.createdAt)}</p>
                </>
              );
              return (
                <li key={n.id} className={cn('group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40', !n.readAt && 'bg-muted/30')}>
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {n.link ? (
                      <Link href={n.link} onClick={() => !n.readAt && read.mutate(n.id)} className="block focus-visible:outline-none focus-visible:underline">{content}</Link>
                    ) : content}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!n.readAt && <span className="size-2 rounded-full bg-accent" aria-label="읽지 않음" />}
                    {!n.readAt && (
                      <Button variant="ghost" size="sm" onClick={() => read.mutate(n.id)} className="opacity-70 group-hover:opacity-100">읽음</Button>
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label="알림 삭제" onClick={() => remove.mutate(n.id)} className="opacity-60 group-hover:opacity-100"><Trash2 /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={list.data.totalPages} onChange={setPage} />
        </>
      )}
    </>
  );
}
