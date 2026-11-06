'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiDelete, apiPost, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/utils';
import { financeKeys, useBusinessUnits, useTransaction, useTransactions } from './api';
import { useProjectOptions } from './budget-form';
import { ReasonDialog } from './budgets-view';
import { Money, TxStatusBadge, TxTypeBadge } from './common';
import { FileLink, useTargetFiles } from './files';
import { TransactionFormDialog } from './transaction-form';
import { TX_STATUS_LABELS, type TxStatus } from './types';

export function TransactionsView() {
  const can = useCan();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState({
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    type: sp.get('type') ?? '',
    status: sp.get('status') ?? '',
    businessUnitId: sp.get('businessUnitId') ?? '',
    projectId: sp.get('projectId') ?? '',
    q: '',
  });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const openId = sp.get('id');
  const { data: units = [] } = useBusinessUnits(true);
  const { data: projects } = useProjectOptions();

  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  const { data, isLoading, error } = useTransactions({ ...query, page, pageSize: 20 });
  const set = (k: keyof typeof filters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const openDetail = (id: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (id) params.set('id', id); else params.delete('id');
    router.replace(`${pathname}${params.toString() ? `?${params}` : ''}`, { scroll: false });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">기간
          <Input type="date" aria-label="시작일" value={filters.from} onChange={(e) => set('from', e.target.value)} className="w-36" />
          ~
          <Input type="date" aria-label="종료일" value={filters.to} onChange={(e) => set('to', e.target.value)} className="w-36" />
        </label>
        <NativeSelect aria-label="구분" value={filters.type} onChange={(e) => set('type', e.target.value)} className="w-24">
          <option value="">전체</option><option value="REVENUE">수입</option><option value="EXPENSE">지출</option>
        </NativeSelect>
        <NativeSelect aria-label="상태" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-28">
          <option value="">전체 상태</option>
          {(Object.keys(TX_STATUS_LABELS) as TxStatus[]).map((s) => <option key={s} value={s}>{TX_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="사업 구분" value={filters.businessUnitId} onChange={(e) => set('businessUnitId', e.target.value)} className="w-36">
          <option value="">전체 사업</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="프로젝트" value={filters.projectId} onChange={(e) => set('projectId', e.target.value)} className="w-40">
          <option value="">전체 프로젝트</option>
          {(projects?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
        </NativeSelect>
        <Input aria-label="적요·거래처 검색" placeholder="적요·거래처 검색" value={filters.q} onChange={(e) => set('q', e.target.value)} className="w-44" />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/v1/finance/transactions/export${qs(query)}`} download><Download /> CSV</a>
          </Button>
          {can('finance.write') && <Button onClick={() => setCreating(true)}><Plus /> 거래 등록</Button>}
        </div>
      </div>

      {data && (
        <p className="mb-3 text-xs text-muted-foreground">
          조회 결과 {data.total.toLocaleString('ko-KR')}건 · 수입 <Money value={data.summary.revenue} className="text-foreground" /> · 지출 <Money value={data.summary.expense} className="text-foreground" /> (상태 무관, 부가세 포함)
        </p>
      )}

      {error ? <ErrorState error={error} /> : isLoading || !data ? <LoadingRows /> : data.items.length === 0 ? (
        <EmptyState title="거래가 없습니다" description="조건에 맞는 수입·지출 거래가 없습니다." action={can('finance.write') ? <Button onClick={() => setCreating(true)}><Plus /> 거래 등록</Button> : undefined} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>거래일</TH><TH>구분</TH><TH>적요</TH><TH>사업 / 프로젝트</TH><TH className="text-right">공급가액</TH><TH className="text-right">부가세</TH><TH className="text-right">합계</TH><TH>상태</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((t) => (
                <TR key={t.id} className="cursor-pointer" onClick={() => openDetail(t.id)}>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(t.txDate)}</TD>
                  <TD><TxTypeBadge type={t.type} /></TD>
                  <TD className="max-w-72">
                    <button type="button" className="truncate text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); openDetail(t.id); }}>
                      {t.description}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.counterparty ?? '-'}{t.evidenceFileId && <Paperclip className="ml-1 inline size-3" aria-label="증빙 있음" />}
                    </p>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{[t.businessUnit?.name, t.project?.name].filter(Boolean).join(' / ') || '-'}</TD>
                  <TD className="text-right"><Money value={t.supplyAmount} /></TD>
                  <TD className="text-right text-muted-foreground"><Money value={t.vatAmount} /></TD>
                  <TD className="text-right font-medium"><Money value={t.totalAmount} /></TD>
                  <TD><TxStatusBadge status={t.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}

      <TransactionFormDialog open={creating} onOpenChange={setCreating} />
      {openId && <TransactionDetailDialog id={openId} onClose={() => openDetail(null)} />}
    </>
  );
}

function TransactionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const { data: t, isLoading, error } = useTransaction(id);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: financeKeys.all });

  const act = useMutation({
    mutationFn: (kind: 'submit' | 'approve' | 'delete') => (kind === 'delete' ? apiDelete(`/finance/transactions/${id}`) : apiPost(`/finance/transactions/${id}/${kind}`)),
    onSuccess: (_d, kind) => {
      toast.success({ submit: '승인 요청했습니다.', approve: '거래를 승인했습니다.', delete: '거래를 삭제했습니다.' }[kind]);
      invalidate();
      if (kind === 'delete') onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => apiPost(`/finance/transactions/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('거래를 반려했습니다.'); invalidate(); setRejecting(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const editable = t && (t.status === 'DRAFT' || t.status === 'REJECTED') && can('finance.write');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        {error ? <ErrorState error={error} /> : isLoading || !t ? <LoadingRows rows={4} /> : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2"><TxTypeBadge type={t.type} /><TxStatusBadge status={t.status} /><span className="text-xs text-muted-foreground">{formatDate(t.txDate)}</span></div>
              <DialogTitle>{t.description}</DialogTitle>
              <DialogDescription>{[t.counterparty, t.businessUnit?.name, t.project ? `${t.project.key} ${t.project.name}` : null, t.department?.name].filter(Boolean).join(' · ') || '연결 정보 없음'}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-3 gap-3">
              {[['공급가액', t.supplyAmount], ['부가세', t.vatAmount], ['합계', t.totalAmount]].map(([l, v]) => (
                <div key={l} className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="mt-1 font-semibold"><Money value={v} /></dd></div>
              ))}
            </dl>

            <section>
              <h3 className="mb-2 text-[13px] font-medium">예산 배분</h3>
              {t.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t.type === 'EXPENSE' ? '배분된 예산 항목이 없습니다.' : '수입 거래는 예산 배분 대상이 아닙니다.'}</p> : (
                <Table>
                  <THead><TR><TH>예산</TH><TH>항목</TH><TH className="text-right">금액</TH></TR></THead>
                  <TBody>
                    {t.allocations.map((a) => (
                      <TR key={a.id}><TD>{a.budgetLine.budget.fiscalYear} {a.budgetLine.budget.name}</TD><TD>{a.budgetLine.category}</TD><TD className="text-right"><Money value={a.amount} /></TD></TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {t.allocations.length > 0 && <p className="mt-1 text-right text-xs text-muted-foreground">미배분 <Money value={t.unallocatedAmount} /></p>}
            </section>

            <section className="text-sm">
              <h3 className="mb-1 text-[13px] font-medium">증빙</h3>
              {t.evidenceFile ? <Evidence txId={t.id} file={t.evidenceFile} /> : <span className="text-muted-foreground">첨부된 증빙이 없습니다.</span>}
            </section>

            <p className="text-xs text-muted-foreground">
              등록 {t.createdBy?.name ?? '-'}
              {t.approvedAt && <> · 승인 {t.approvedBy?.name ?? '-'} ({formatDateTime(t.approvedAt)})</>}
              {t.approvalRequestId && <> · <a className="underline" href={`/admin/approvals?id=${t.approvalRequestId}`}>연결된 결재 문서</a></>}
            </p>

            <DialogFooter className="flex-wrap">
              {can('finance.write') && t.status !== 'APPROVED' && (
                <Button variant="ghost" className="text-danger" onClick={() => confirm('이 거래를 삭제할까요?') && act.mutate('delete')}>삭제</Button>
              )}
              {editable && <Button variant="outline" onClick={() => setEditing(true)}>수정</Button>}
              {editable && <Button variant="outline" onClick={() => act.mutate('submit')} loading={act.isPending && act.variables === 'submit'}>승인 요청</Button>}
              {t.status === 'PENDING' && can('finance.approve') && (
                t.canApprove ? (
                  <>
                    <Button variant="outline" onClick={() => setRejecting(true)}>반려</Button>
                    <Button onClick={() => act.mutate('approve')} loading={act.isPending && act.variables === 'approve'}>승인</Button>
                  </>
                ) : <p className="self-center text-xs text-muted-foreground">본인이 등록한 거래는 승인할 수 없습니다 (직무 분리).</p>
              )}
            </DialogFooter>
            <TransactionFormDialog open={editing} onOpenChange={setEditing} tx={t} />
            {rejecting && <ReasonDialog title="거래 반려" confirmLabel="반려" onSubmit={(r) => reject.mutate(r)} onClose={() => setRejecting(false)} pending={reject.isPending} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Evidence({ txId, file }: { txId: string; file: { id: string; originalName: string; size: number } }) {
  const { data } = useTargetFiles('TRANSACTION', txId);
  return <FileLink file={file} url={data?.find((f) => f.id === file.id)?.url} />;
}
