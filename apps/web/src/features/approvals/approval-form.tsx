'use client';
import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES, type ApprovalType } from '@oogam/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar } from '@/components/ui/misc';
import { apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useDirectory } from '@/lib/directory';
import { uploadFile } from '@/features/finance/api';
import { useProjectOptions } from '@/features/finance/budget-form';
import { AMOUNT_RE, cleanAmount, krw } from '@/features/finance/common';
import type { Budget, Transaction } from '@/features/finance/types';
import type { ApprovalDetail } from './types';

/** 결재선 편집: 순서가 있는 결재자 목록 (1~10명, 본인 제외) */
function ApproverLine({ value, onChange, exclude }: { value: string[]; onChange: (v: string[]) => void; exclude: string[] }) {
  const { data: users = [] } = useDirectory();
  const byId = new Map(users.map((u) => [u.id, u]));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ol className="space-y-1.5" aria-label="결재선">
          {value.map((id, i) => {
            const u = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                <span className="w-5 text-center text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                <Avatar name={u?.name} src={u?.avatarUrl} className="size-6" />
                <span className="min-w-0 flex-1 truncate">{u?.name ?? '알 수 없음'} <span className="text-xs text-muted-foreground">{u?.department?.name ?? ''}{u?.title ? ` · ${u.title}` : ''}</span></span>
                {i === value.length - 1 && <span className="text-[11px] text-muted-foreground">최종</span>}
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`${u?.name ?? ''} 위로`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`${u?.name ?? ''} 아래로`} disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`${u?.name ?? ''} 제거`} onClick={() => onChange(value.filter((v) => v !== id))}><X /></Button>
              </li>
            );
          })}
        </ol>
      )}
      {value.length < 10 && (
        <UserPicker
          multiple={false}
          value={[]}
          onChange={(ids) => ids[0] && onChange([...value, ids[0]])}
          exclude={[...exclude, ...value]}
          placeholder={value.length ? '결재자 추가' : '결재자 선택 (순서대로 추가)'}
        />
      )}
    </div>
  );
}

export function ApprovalFormDialog({ open, onOpenChange, approval, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; approval?: ApprovalDetail; onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        {open && <ApprovalForm approval={approval} onDone={(id) => { onOpenChange(false); if (id) onSaved?.(id); }} />}
      </DialogContent>
    </Dialog>
  );
}

function ApprovalForm({ approval, onDone }: { approval?: ApprovalDetail; onDone: (id?: string) => void }) {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const finance = can('finance.read');
  const { data: projects } = useProjectOptions();
  const budgets = useQuery({
    queryKey: ['finance', 'budgets', 'approval-options'],
    queryFn: () => apiGet<Paginated<Budget>>('/finance/budgets', { pageSize: 100 }),
    enabled: finance,
    retry: false,
  });
  const txs = useQuery({
    queryKey: ['finance', 'transactions', 'approval-options'],
    queryFn: () => apiGet<Paginated<Transaction>>('/finance/transactions', { pageSize: 100, type: 'EXPENSE' }),
    enabled: finance,
    retry: false,
  });
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ApprovalType>(approval?.type ?? 'GENERAL');
  const [title, setTitle] = useState(approval?.title ?? '');
  const [content, setContent] = useState(approval?.content ?? '');
  const [amount, setAmount] = useState(approval?.amount ?? '');
  const [approverIds, setApproverIds] = useState<string[]>(approval?.steps.map((s) => s.approver.id) ?? []);
  const [projectId, setProjectId] = useState(approval?.projectId ?? '');
  const [budgetId, setBudgetId] = useState(approval?.budgetId ?? '');
  const [transactionId, setTransactionId] = useState(approval?.transactionId ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const amountOk = !amount || AMOUNT_RE.test(cleanAmount(amount));
  const errors = {
    title: !title.trim() ? '제목을 입력하세요.' : undefined,
    approvers: approverIds.length === 0 ? '결재자를 1명 이상 지정하세요.' : undefined,
    amount: amountOk ? undefined : '0 이상, 소수점 2자리까지 입력하세요.',
  };
  const ok = !errors.title && !errors.approvers && !errors.amount;

  const mutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = {
        type,
        title: title.trim(),
        content,
        amount: amount ? cleanAmount(amount) : null,
        approverIds,
        projectId: projectId || null,
        ...(finance ? { budgetId: budgetId || null, transactionId: transactionId || null } : {}),
      };
      let saved: ApprovalDetail;
      if (approval) {
        saved = await apiPatch<ApprovalDetail>(`/approvals/${approval.id}`, { ...body, version: approval.version });
      } else {
        saved = await apiPost<ApprovalDetail>('/approvals', body);
      }
      for (const f of files) {
        try {
          await uploadFile(f, 'APPROVAL', saved.id);
        } catch (e) {
          toast.warning(`첨부 업로드 실패 (${f.name}): ${(e as Error).message}`);
        }
      }
      if (submit) saved = await apiPost<ApprovalDetail>(`/approvals/${saved.id}/submit`, { version: saved.version });
      return saved;
    },
    onSuccess: (saved, submit) => {
      toast.success(submit ? `${saved.number} 문서를 상신했습니다.` : '임시저장했습니다.');
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['files', 'APPROVAL', saved.id] });
      onDone(saved.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = (submit: boolean) => {
    setSubmitted(true);
    if (ok) mutation.mutate(submit);
  };

  const budgetOptions = (budgets.data?.items ?? []).filter((b) => type !== 'BUDGET' || b.status === 'DRAFT' || b.status === 'PENDING_APPROVAL' || b.id === budgetId);
  const txOptions = (txs.data?.items ?? []).filter((t) => t.status !== 'APPROVED' || t.id === transactionId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{approval ? `${approval.number} 수정` : '결재 작성'}</DialogTitle>
        <DialogDescription>결재선은 위에서부터 순서대로 진행됩니다. 보완 요청 후 재상신하면 결재선이 처음부터 다시 진행됩니다.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="문서 종류" htmlFor="ap-type">
            <NativeSelect id="ap-type" value={type} onChange={(e) => setType(e.target.value as ApprovalType)}>
              {APPROVAL_TYPES.map((t) => <option key={t} value={t}>{APPROVAL_TYPE_LABELS[t]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="제목" htmlFor="ap-title" error={submitted ? errors.title : undefined}>
            <Input id="ap-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <Field label="내용" htmlFor="ap-content">
          <Textarea id="ap-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} placeholder="요청 배경, 내역, 기대 효과 등을 작성하세요." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="금액 (선택)" htmlFor="ap-amount" error={submitted ? errors.amount : undefined} hint={transactionId || (type === 'BUDGET' && budgetId) ? '비워 두면 연결 대상 금액으로 채워집니다.' : undefined}>
            <Input id="ap-amount" inputMode="decimal" className="text-right tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="관련 프로젝트" htmlFor="ap-project">
            <NativeSelect id="ap-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">선택 안 함</option>
              {(projects?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </NativeSelect>
          </Field>
          {finance && (
            <>
              <Field label="연결 예산" htmlFor="ap-budget" hint={type === 'BUDGET' ? '최종 승인 시 예산이 편성 금액으로 승인됩니다.' : undefined}>
                <NativeSelect id="ap-budget" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {budgetOptions.map((b) => <option key={b.id} value={b.id}>{b.fiscalYear} {b.name} ({krw(b.plannedAmount)})</option>)}
                </NativeSelect>
              </Field>
              <Field label="연결 지출 거래" htmlFor="ap-tx" hint={type === 'EXPENSE' ? '최종 승인 시 거래가 승인 처리됩니다. 거래 등록자는 최종 결재자가 될 수 없습니다.' : undefined}>
                <NativeSelect id="ap-tx" value={transactionId} onChange={(e) => setTransactionId(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {txOptions.map((t) => <option key={t.id} value={t.id}>{t.txDate.slice(0, 10)} {t.description} ({krw(t.totalAmount)})</option>)}
                </NativeSelect>
              </Field>
            </>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">결재선</p>
          <ApproverLine value={approverIds} onChange={setApproverIds} exclude={[me.user.id]} />
          {submitted && errors.approvers && <p className="mt-1 text-xs text-danger" role="alert">{errors.approvers}</p>}
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">첨부</p>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                <Paperclip className="size-3" />{f.name}
                <button type="button" aria-label={`${f.name} 제거`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><X className="size-3" /></button>
              </span>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Paperclip /> 파일 추가</Button>
            <input ref={fileInput} type="file" hidden multiple onChange={(e) => { const list = Array.from(e.target.files ?? []); setFiles((fs) => [...fs, ...list]); e.target.value = ''; }} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onDone()}>취소</Button>
          <Button type="submit" variant="outline" loading={mutation.isPending && mutation.variables === false}>임시저장</Button>
          <Button type="button" onClick={() => save(true)} loading={mutation.isPending && mutation.variables === true}>{approval?.status === 'CHANGES_REQUESTED' ? '재상신' : '상신'}</Button>
        </DialogFooter>
      </form>
    </>
  );
}
