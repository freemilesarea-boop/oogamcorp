'use client';
import { APPROVAL_STATUS_LABELS, APPROVAL_STATUSES, APPROVAL_TYPE_LABELS, APPROVAL_TYPES } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, timeAgo } from '@/lib/utils';
import { krw } from '@/features/finance/common';
import { ApprovalDetailPanel } from './approval-detail';
import { ApprovalFormDialog } from './approval-form';
import type { ApprovalListItem, Box } from './types';
import { ApprovalStatusBadge } from './ui';

const BOX_LABELS: Record<Box, string> = { todo: '결재 대기', mine: '내가 올린', done: '완료', all: '전체' };
const EMPTY: Record<Box, string> = {
  todo: '결재할 문서가 없습니다.',
  mine: '작성한 결재 문서가 없습니다.',
  done: '처리한 결재 문서가 없습니다.',
  all: '결재 문서가 없습니다.',
};

export function ApprovalsView() {
  const can = useCan();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = sp.get('id');
  const [box, setBox] = useState<Box>((sp.get('box') as Box) || 'todo');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}${params.toString() ? `?${params}` : ''}`, { scroll: false });
  };

  const summary = useQuery({ queryKey: ['approvals', 'summary'], queryFn: () => apiGet<{ todo: number; minePending: number; changesRequested: number; drafts: number }>('/approvals/summary') });
  const list = useQuery({
    queryKey: ['approvals', 'list', box, status, type, q, page],
    queryFn: () => apiGet<Paginated<ApprovalListItem>>('/approvals', { box, status: status || undefined, type: type || undefined, q: q || undefined, page, pageSize: 20 }),
  });
  const boxes: Box[] = can('approvals.read_all') ? ['todo', 'mine', 'done', 'all'] : ['todo', 'mine', 'done'];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={box} onValueChange={(v) => { setBox(v as Box); setPage(1); setParam('box', v); }}>
          <TabsList>
            {boxes.map((b) => (
              <TabsTrigger noPanel key={b} value={b}>
                {BOX_LABELS[b]}
                {b === 'todo' && !!summary.data?.todo && <span className="rounded-full bg-foreground px-1.5 text-[10px] text-background tabular-nums">{summary.data.todo}</span>}
                {b === 'mine' && !!summary.data?.changesRequested && <span className="rounded-full bg-warning px-1.5 text-[10px] text-white tabular-nums" title="보완 요청">{summary.data.changesRequested}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <NativeSelect aria-label="상태" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-28">
          <option value="">전체 상태</option>
          {APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{APPROVAL_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="문서 종류" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-28">
          <option value="">전체 종류</option>
          {APPROVAL_TYPES.map((t) => <option key={t} value={t}>{APPROVAL_TYPE_LABELS[t]}</option>)}
        </NativeSelect>
        <Input aria-label="제목·문서번호 검색" placeholder="제목·문서번호 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-44" />
        {can('approvals.request') && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> 결재 작성</Button>}
      </div>

      <div className={cn('grid gap-6', selected && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]')}>
        <div className={cn(selected && 'hidden lg:block')}>
          {list.error ? <ErrorState error={list.error} /> : list.isLoading || !list.data ? <LoadingRows /> : list.data.items.length === 0 ? (
            <EmptyState title={EMPTY[box]} action={box === 'mine' && can('approvals.request') ? <Button onClick={() => setCreating(true)}><Plus /> 결재 작성</Button> : undefined} />
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {list.data.items.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setParam('id', r.id)}
                      aria-current={selected === r.id ? 'true' : undefined}
                      className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50', selected === r.id && 'bg-muted')}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{r.number}</span>
                        <span>{APPROVAL_TYPE_LABELS[r.type]}</span>
                        <span className="ml-auto">{timeAgo(r.updatedAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                        {r.isMyTurn && <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">내 차례</span>}
                        <ApprovalStatusBadge status={r.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span>기안 {r.requester?.name ?? '-'}</span>
                        <span className="flex items-center gap-0.5" aria-label={`결재 진행 ${r.steps.filter((s) => s.status === 'APPROVED').length}/${r.stepCount}`}>
                          {r.steps.map((s) => (
                            <span key={s.order} title={`${s.order}. ${s.approver.name}`} className={cn('h-1.5 w-4 rounded-full', s.status === 'APPROVED' ? 'bg-foreground' : s.status === 'PENDING' ? 'bg-foreground/40' : s.status === 'REJECTED' ? 'bg-danger' : s.status === 'CHANGES_REQUESTED' ? 'bg-warning' : 'bg-border')} />
                          ))}
                        </span>
                        {r.currentApprover && <span>현재 {r.currentApprover.name}</span>}
                        {r.amount && <span className="ml-auto tabular-nums text-foreground">{krw(r.amount)}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />
            </>
          )}
        </div>
        {selected && (
          <div className="rounded-lg border border-border p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <ApprovalDetailPanel key={selected} id={selected} onClose={() => setParam('id', null)} />
          </div>
        )}
      </div>

      <ApprovalFormDialog open={creating} onOpenChange={setCreating} onSaved={(id) => { setBox('mine'); setParam('id', id); }} />
    </>
  );
}
