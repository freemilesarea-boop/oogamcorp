'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiDelete, apiPost } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { financeKeys, useBudget, useBudgets } from './api';
import { BudgetFormDialog } from './budget-form';
import { AMOUNT_RE, BudgetStatusBadge, cleanAmount, ExecutionBar, krw, Money } from './common';
import { BUDGET_STATUS_LABELS, type Budget, type BudgetStatus } from './types';

const periodLabel = (b: Pick<Budget, 'period' | 'quarter' | 'fiscalYear'>) => `${b.fiscalYear}년 ${b.period === 'QUARTERLY' ? `${b.quarter}분기` : '연간'}`;

export function BudgetsView() {
  const can = useCan();
  const thisYear = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState<string>(String(thisYear));
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useBudgets({ fiscalYear: fiscalYear || undefined, status: status || undefined, q: q || undefined, page, pageSize: 20 });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <NativeSelect aria-label="회계연도" value={fiscalYear} onChange={(e) => { setFiscalYear(e.target.value); setPage(1); }} className="w-32">
          <option value="">전체 연도</option>
          {Array.from({ length: 6 }, (_, i) => thisYear + 1 - i).map((y) => <option key={y} value={y}>{y}년</option>)}
        </NativeSelect>
        <NativeSelect aria-label="상태" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-32">
          <option value="">전체 상태</option>
          {(Object.keys(BUDGET_STATUS_LABELS) as BudgetStatus[]).map((s) => <option key={s} value={s}>{BUDGET_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        <Input aria-label="예산명 검색" placeholder="예산명 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-48" />
        <div className="ml-auto">
          {can('finance.write') && <Button onClick={() => setCreating(true)}><Plus /> 예산 편성</Button>}
        </div>
      </div>

      {error ? <ErrorState error={error} /> : isLoading || !data ? <LoadingRows /> : data.items.length === 0 ? (
        <EmptyState title="예산이 없습니다" description="예산을 편성하고 승인하면 거래 집행을 예산 항목에 배분할 수 있습니다." action={can('finance.write') ? <Button onClick={() => setCreating(true)}><Plus /> 예산 편성</Button> : undefined} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>예산</TH>
                <TH>기간</TH>
                <TH>상태</TH>
                <TH className="text-right">편성</TH>
                <TH className="text-right">승인</TH>
                <TH className="min-w-56">집행 / 승인</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((b) => (
                <TR key={b.id} className="cursor-pointer" onClick={() => setOpenId(b.id)}>
                  <TD>
                    <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(b.id); }}>{b.name}</button>
                    <p className="text-xs text-muted-foreground">{[b.businessUnit?.name, b.department?.name, b.project?.name].filter(Boolean).join(' · ') || '-'}</p>
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{periodLabel(b)}</TD>
                  <TD><BudgetStatusBadge status={b.status} /></TD>
                  <TD className="text-right"><Money value={b.plannedAmount} /></TD>
                  <TD className="text-right"><Money value={b.approvedAmount} /></TD>
                  <TD>
                    {b.status === 'APPROVED' || b.status === 'CLOSED'
                      ? <ExecutionBar executed={b.executedAmount} approved={b.approvedAmount} rate={b.executionRate} />
                      : <span className="text-xs text-muted-foreground">승인 전</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}

      <BudgetFormDialog open={creating} onOpenChange={setCreating} />
      {openId && <BudgetDetailDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function BudgetDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const { data: b, isLoading, error } = useBudget(id);
  const [editing, setEditing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [returning, setReturning] = useState(false);

  const act = useMutation({
    mutationFn: (kind: 'submit' | 'close' | 'delete') =>
      kind === 'delete' ? apiDelete(`/finance/budgets/${id}`) : apiPost(`/finance/budgets/${id}/${kind}`),
    onSuccess: (_d, kind) => {
      toast.success({ submit: '승인 요청했습니다.', close: '예산을 마감했습니다.', delete: '예산을 삭제했습니다.' }[kind]);
      qc.invalidateQueries({ queryKey: financeKeys.all });
      if (kind === 'delete') onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        {error ? <ErrorState error={error} /> : isLoading || !b ? <LoadingRows rows={4} /> : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2"><BudgetStatusBadge status={b.status} /><span className="text-xs text-muted-foreground">{periodLabel(b)}</span></div>
              <DialogTitle>{b.name}</DialogTitle>
              <DialogDescription>
                {[b.businessUnit?.name, b.department?.name, b.project ? `${b.project.key} ${b.project.name}` : null].filter(Boolean).join(' · ') || '연결 정보 없음'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['편성', b.plannedAmount], ['승인', b.approvedAmount], ['집행', b.executedAmount], ['잔액', b.remainingAmount],
              ].map(([label, v]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 font-semibold"><Money value={v} signed /></p>
                </div>
              ))}
            </div>

            <Table>
              <THead>
                <TR><TH>항목</TH><TH className="text-right">편성</TH><TH className="text-right">승인</TH><TH className="min-w-48">집행</TH><TH className="text-right">잔액</TH></TR>
              </THead>
              <TBody>
                {b.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <p className="font-medium">{l.category}</p>
                      {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                    </TD>
                    <TD className="text-right"><Money value={l.plannedAmount} /></TD>
                    <TD className="text-right"><Money value={l.approvedAmount} /></TD>
                    <TD><ExecutionBar executed={l.executedAmount} approved={l.approvedAmount} rate={l.executionRate} /></TD>
                    <TD className="text-right"><Money value={l.remainingAmount} signed /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {b.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{b.notes}</p>}
            <p className="text-xs text-muted-foreground">
              등록 {b.createdBy?.name ?? '-'} · {formatDateTime(b.createdAt)}
              {b.approvedAt && <> · 승인 {b.approvedBy?.name ?? '-'} · {formatDateTime(b.approvedAt)}</>}
            </p>

            <DialogFooter className="flex-wrap">
              {b.status === 'DRAFT' && can('finance.write') && (
                <>
                  <Button variant="ghost" className="text-danger" onClick={() => confirm('이 예산을 삭제할까요?') && act.mutate('delete')}>삭제</Button>
                  <Button variant="outline" onClick={() => setEditing(true)}>수정</Button>
                  <Button variant="outline" onClick={() => act.mutate('submit')} loading={act.isPending}>승인 요청</Button>
                </>
              )}
              {b.status === 'PENDING_APPROVAL' && can('finance.approve') && (
                <Button variant="outline" onClick={() => setReturning(true)}>반려</Button>
              )}
              {(b.status === 'DRAFT' || b.status === 'PENDING_APPROVAL') && can('finance.approve') && (
                <Button onClick={() => setApproving(true)}>승인</Button>
              )}
              {b.status === 'APPROVED' && can('finance.approve') && (
                <Button variant="outline" onClick={() => confirm('예산을 마감하면 더 이상 배분할 수 없습니다. 마감할까요?') && act.mutate('close')}>마감</Button>
              )}
            </DialogFooter>

            <BudgetFormDialog open={editing} onOpenChange={setEditing} budget={b} />
            {approving && <ApproveBudgetDialog budget={b} onClose={() => setApproving(false)} />}
            {returning && <ReturnBudgetDialog id={b.id} onClose={() => setReturning(false)} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApproveBudgetDialog({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const qc = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(budget.lines.map((l) => [l.id, l.plannedAmount])));
  const [comment, setComment] = useState('');
  const invalid = Object.values(amounts).some((v) => !AMOUNT_RE.test(cleanAmount(v)));
  const m = useMutation({
    mutationFn: () => apiPost(`/finance/budgets/${budget.id}/approve`, {
      lines: Object.entries(amounts).map(([lineId, v]) => ({ lineId, approvedAmount: cleanAmount(v) })),
      comment: comment || undefined,
    }),
    onSuccess: () => {
      toast.success('예산을 승인했습니다.');
      qc.invalidateQueries({ queryKey: financeKeys.all });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>예산 승인</DialogTitle>
          <DialogDescription>항목별 승인 금액을 확정합니다. 기본값은 편성 금액입니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {budget.lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_10rem] items-center gap-2">
              <label htmlFor={`ap-${l.id}`} className="text-sm">{l.category}<span className="block text-xs text-muted-foreground">편성 {krw(l.plannedAmount)}</span></label>
              <Input id={`ap-${l.id}`} inputMode="decimal" className="text-right tabular-nums" value={amounts[l.id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))} />
            </div>
          ))}
        </div>
        <Field label="의견 (선택)" htmlFor="ap-comment"><Textarea id="ap-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} /></Field>
        {invalid && <p className="text-xs text-danger" role="alert">금액은 0 이상, 소수점 2자리까지 입력하세요.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={invalid}>승인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReasonDialog({ title, description, confirmLabel, onSubmit, onClose, pending }: {
  title: string; description?: string; confirmLabel: string; onSubmit: (reason: string) => void; onClose: () => void; pending?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Field label="사유" htmlFor="reason-input">
          <Textarea id="reason-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus required />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={() => onSubmit(reason.trim())} disabled={!reason.trim()} loading={pending}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnBudgetDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (reason: string) => apiPost(`/finance/budgets/${id}/return`, { reason }),
    onSuccess: () => {
      toast.success('예산을 반려했습니다.');
      qc.invalidateQueries({ queryKey: financeKeys.all });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return <ReasonDialog title="예산 반려" description="작성 중 상태로 되돌립니다." confirmLabel="반려" onSubmit={(r) => m.mutate(r)} onClose={onClose} pending={m.isPending} />;
}
