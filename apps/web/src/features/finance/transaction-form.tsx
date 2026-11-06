'use client';
import { addAmounts, calcVat, compareAmounts } from '@oogam/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { apiPatch, apiPost } from '@/lib/api';
import { useDepartments } from '@/lib/directory';
import { toDateInput } from '@/lib/utils';
import { financeKeys, uploadFile, useBudgetLineOptions, useBusinessUnits } from './api';
import { useProjectOptions } from './budget-form';
import { AMOUNT_RE, cleanAmount, krw } from './common';
import type { Transaction, TxType } from './types';

interface AllocRow { key: number; budgetLineId: string; amount: string }

const valid = (v: string) => AMOUNT_RE.test(cleanAmount(v));
const sumSafe = (vals: string[]) => {
  try {
    return addAmounts(...vals.map((v) => cleanAmount(v) || '0'));
  } catch {
    return null;
  }
};

/** 거래 등록/수정. 부가세 자동 계산(10%, 원 단위 절사)·증빙 업로드·예산 배분 편집 */
export function TransactionFormDialog({ open, onOpenChange, tx }: { open: boolean; onOpenChange: (o: boolean) => void; tx?: Transaction }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        {open && <TransactionForm tx={tx} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({ tx, onDone }: { tx?: Transaction; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: units = [] } = useBusinessUnits();
  const { data: departments = [] } = useDepartments();
  const { data: projects } = useProjectOptions();
  const { data: lineOptions = [] } = useBudgetLineOptions();
  const fileInput = useRef<HTMLInputElement>(null);

  const [txDate, setTxDate] = useState(tx ? toDateInput(tx.txDate) : new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<TxType>(tx?.type ?? 'EXPENSE');
  const [businessUnitId, setBusinessUnitId] = useState(tx?.businessUnitId ?? '');
  const [projectId, setProjectId] = useState(tx?.projectId ?? '');
  const [departmentId, setDepartmentId] = useState(tx?.departmentId ?? '');
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? '');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [supply, setSupply] = useState(tx?.supplyAmount ?? '');
  const [autoVat, setAutoVat] = useState(!tx);
  const [vat, setVat] = useState(tx?.vatAmount ?? '0');
  const [file, setFile] = useState<File | null>(null);
  const [removeEvidence, setRemoveEvidence] = useState(false);
  const [allocs, setAllocs] = useState<AllocRow[]>(() => (tx?.allocations ?? []).map((a, i) => ({ key: i, budgetLineId: a.budgetLineId, amount: a.amount })));
  const [submitted, setSubmitted] = useState(false);

  const supplyOk = valid(supply);
  const effectiveVat = autoVat ? (supplyOk ? calcVat(cleanAmount(supply)) : '0') : vat;
  const vatOk = valid(effectiveVat);
  const total = supplyOk && vatOk ? addAmounts(cleanAmount(supply), cleanAmount(effectiveVat)) : null;
  const allocSum = sumSafe(allocs.map((a) => a.amount));
  const allocOver = !!(total && allocSum && compareAmounts(allocSum, total) > 0);
  const allocInvalid = allocs.some((a) => !a.budgetLineId || !valid(a.amount) || cleanAmount(a.amount) === '0') || new Set(allocs.map((a) => a.budgetLineId)).size !== allocs.length;
  const formOk = !!txDate && description.trim().length > 0 && supplyOk && vatOk && !allocOver && (type === 'REVENUE' || !allocInvalid);

  const mutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = {
        txDate,
        type,
        businessUnitId: businessUnitId || null,
        projectId: projectId || null,
        departmentId: departmentId || null,
        counterparty: counterparty.trim() || null,
        description: description.trim(),
        supplyAmount: cleanAmount(supply),
        ...(autoVat ? { autoVat: true } : { vatAmount: cleanAmount(vat) }),
        allocations: type === 'EXPENSE' ? allocs.map((a) => ({ budgetLineId: a.budgetLineId, amount: cleanAmount(a.amount) })) : [],
        ...(tx && removeEvidence ? { evidenceFileId: null } : {}),
      };
      const saved = tx ? await apiPatch<Transaction>(`/finance/transactions/${tx.id}`, body) : await apiPost<Transaction>('/finance/transactions', body);
      if (file) {
        try {
          const up = await uploadFile(file, 'TRANSACTION', saved.id);
          await apiPatch(`/finance/transactions/${saved.id}`, { evidenceFileId: up.id });
        } catch (e) {
          toast.warning(`거래는 저장되었지만 증빙 업로드에 실패했습니다: ${(e as Error).message}`);
        }
      }
      if (submit) await apiPost(`/finance/transactions/${saved.id}/submit`);
      return saved;
    },
    onSuccess: (_d, submit) => {
      toast.success(submit ? '거래를 저장하고 승인 요청했습니다.' : '거래를 저장했습니다.');
      qc.invalidateQueries({ queryKey: financeKeys.all });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = (submit: boolean) => {
    setSubmitted(true);
    if (formOk) mutation.mutate(submit);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tx ? '거래 수정' : '거래 등록'}</DialogTitle>
        <DialogDescription>합계는 공급가액 + 부가세로 서버에서 다시 계산됩니다. 승인 후에는 수정할 수 없습니다.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="거래일" htmlFor="tx-date" error={submitted && !txDate ? '거래일을 입력하세요.' : undefined}>
            <Input id="tx-date" type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
          </Field>
          <Field label="구분" htmlFor="tx-type">
            <NativeSelect id="tx-type" value={type} onChange={(e) => setType(e.target.value as TxType)}>
              <option value="EXPENSE">지출</option>
              <option value="REVENUE">수입</option>
            </NativeSelect>
          </Field>
          <Field label="거래처" htmlFor="tx-cp">
            <Input id="tx-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={200} />
          </Field>
          <div className="sm:col-span-3">
            <Field label="적요" htmlFor="tx-desc" error={submitted && !description.trim() ? '적요를 입력하세요.' : undefined}>
              <Input id="tx-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="예: 촬영 장비 렌탈" />
            </Field>
          </div>
          <Field label="사업 구분" htmlFor="tx-unit">
            <NativeSelect id="tx-unit" value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)}>
              <option value="">선택 안 함</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="프로젝트" htmlFor="tx-proj">
            <NativeSelect id="tx-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">선택 안 함</option>
              {(projects?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="부서" htmlFor="tx-dept">
            <NativeSelect id="tx-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">선택 안 함</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
          <Field label="공급가액" htmlFor="tx-supply" error={submitted && !supplyOk ? '0 이상, 소수점 2자리까지 입력하세요.' : undefined}>
            <Input id="tx-supply" inputMode="decimal" className="text-right tabular-nums" value={supply} onChange={(e) => setSupply(e.target.value)} placeholder="0" />
          </Field>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="tx-vat" className="text-[13px] font-medium">부가세</label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Switch checked={autoVat} onCheckedChange={setAutoVat} aria-label="부가세 10% 자동 계산" /> 10% 자동
              </label>
            </div>
            <Input id="tx-vat" inputMode="decimal" className="text-right tabular-nums" value={autoVat ? effectiveVat : vat} onChange={(e) => setVat(e.target.value)} disabled={autoVat} />
            {submitted && !vatOk && <p className="text-xs text-danger">부가세 형식을 확인하세요.</p>}
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">합계</p>
            <p className="flex h-9 items-center justify-end rounded-md bg-muted px-3 text-sm font-semibold tabular-nums">{total ? krw(total) : '-'}</p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium">증빙</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {tx?.evidenceFile && !removeEvidence && !file && (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                <Paperclip className="size-3" /> {tx.evidenceFile.originalName}
                <button type="button" aria-label="증빙 연결 해제" onClick={() => setRemoveEvidence(true)}><X className="size-3" /></button>
              </span>
            )}
            {file && (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                <Paperclip className="size-3" /> {file.name}
                <button type="button" aria-label="선택 취소" onClick={() => setFile(null)}><X className="size-3" /></button>
              </span>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Paperclip /> 파일 선택</Button>
            <input ref={fileInput} type="file" hidden accept="image/*,application/pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            <span className="text-xs text-muted-foreground">영수증·세금계산서 (저장 시 업로드)</span>
          </div>
        </div>

        {type === 'EXPENSE' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">예산 배분 <span className="font-normal text-muted-foreground">(승인된 예산 항목)</span></p>
              <Button type="button" size="sm" variant="outline" onClick={() => setAllocs((a) => [...a, { key: Date.now(), budgetLineId: '', amount: total && a.length === 0 ? total : '' }])} disabled={lineOptions.length === 0}>
                <Plus /> 배분 추가
              </Button>
            </div>
            {lineOptions.length === 0 && <p className="text-xs text-muted-foreground">배분할 수 있는 승인된 예산이 없습니다.</p>}
            <div className="space-y-2">
              {allocs.map((a, i) => {
                const opt = lineOptions.find((o) => o.id === a.budgetLineId);
                return (
                  <div key={a.key} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2">
                    <div>
                      <NativeSelect aria-label={`${i + 1}번 배분 예산 항목`} value={a.budgetLineId} onChange={(e) => setAllocs((rows) => rows.map((r) => r.key === a.key ? { ...r, budgetLineId: e.target.value } : r))}>
                        <option value="">예산 항목 선택</option>
                        {lineOptions.map((o) => <option key={o.id} value={o.id}>{o.budget.fiscalYear} {o.budget.name} › {o.category}</option>)}
                      </NativeSelect>
                      {opt && <p className="mt-1 text-[11px] text-muted-foreground">잔액 {krw(opt.remainingAmount)} / 승인 {krw(opt.approvedAmount)}</p>}
                    </div>
                    <Input aria-label={`${i + 1}번 배분 금액`} inputMode="decimal" className="text-right tabular-nums" value={a.amount} onChange={(e) => setAllocs((rows) => rows.map((r) => r.key === a.key ? { ...r, amount: e.target.value } : r))} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`${i + 1}번 배분 삭제`} onClick={() => setAllocs((rows) => rows.filter((r) => r.key !== a.key))}><Trash2 /></Button>
                  </div>
                );
              })}
            </div>
            {allocs.length > 0 && (
              <p className={`mt-2 text-right text-xs ${allocOver ? 'text-danger' : 'text-muted-foreground'}`} role={allocOver ? 'alert' : undefined}>
                배분 합계 {allocSum ? krw(allocSum) : '-'} / 거래 합계 {total ? krw(total) : '-'}{allocOver && ' — 거래 합계를 초과합니다'}
              </p>
            )}
            {submitted && allocInvalid && <p className="mt-1 text-xs text-danger">배분 항목과 금액(0 초과)을 확인하세요. 같은 항목은 한 번만 배분할 수 있습니다.</p>}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>취소</Button>
          <Button type="submit" variant="outline" loading={mutation.isPending && mutation.variables === false}>저장</Button>
          <Button type="button" onClick={() => save(true)} loading={mutation.isPending && mutation.variables === true}>저장 후 승인 요청</Button>
        </DialogFooter>
      </form>
    </>
  );
}
