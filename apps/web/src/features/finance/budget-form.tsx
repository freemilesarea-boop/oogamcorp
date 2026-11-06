'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { addAmounts } from '@oogam/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { useDepartments } from '@/lib/directory';
import { financeKeys, useBusinessUnits } from './api';
import { AMOUNT_RE, cleanAmount, krw } from './common';
import type { Budget } from './types';

const amount = z.string().transform(cleanAmount).refine((v) => AMOUNT_RE.test(v), '0 이상, 소수점 2자리까지 입력하세요.');

const schema = z
  .object({
    name: z.string().trim().min(1, '예산명을 입력하세요.').max(200),
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    period: z.enum(['ANNUAL', 'QUARTERLY']),
    quarter: z.string(),
    businessUnitId: z.string(),
    departmentId: z.string(),
    projectId: z.string(),
    notes: z.string().max(5000),
    lines: z.array(z.object({ category: z.string().trim().min(1, '항목명을 입력하세요.').max(100), description: z.string().max(500), plannedAmount: amount })).max(200),
  })
  .refine((v) => v.period !== 'QUARTERLY' || ['1', '2', '3', '4'].includes(v.quarter), { path: ['quarter'], message: '분기를 선택하세요.' });

type Input = z.input<typeof schema>;
type Values = z.output<typeof schema>;

export function useProjectOptions() {
  return useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => apiGet<Paginated<{ id: string; key: string; name: string }>>('/projects', { pageSize: 100, sort: 'name', order: 'asc' }),
    staleTime: 60_000,
    retry: false,
  });
}

function safeSum(values: string[]): string | null {
  try {
    return addAmounts(...values.map((v) => cleanAmount(v) || '0'));
  } catch {
    return null;
  }
}

export function BudgetFormDialog({ open, onOpenChange, budget }: { open: boolean; onOpenChange: (o: boolean) => void; budget?: Budget }) {
  const qc = useQueryClient();
  const { data: units = [] } = useBusinessUnits();
  const { data: departments = [] } = useDepartments();
  const { data: projects } = useProjectOptions();
  const form = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    values: budget
      ? {
          name: budget.name, fiscalYear: budget.fiscalYear, period: budget.period, quarter: budget.quarter ? String(budget.quarter) : '',
          businessUnitId: budget.businessUnitId ?? '', departmentId: budget.departmentId ?? '', projectId: budget.projectId ?? '', notes: budget.notes ?? '',
          lines: budget.lines.map((l) => ({ category: l.category, description: l.description ?? '', plannedAmount: l.plannedAmount })),
        }
      : {
          name: '', fiscalYear: new Date().getFullYear(), period: 'ANNUAL', quarter: '', businessUnitId: '', departmentId: '', projectId: '', notes: '',
          lines: [{ category: '', description: '', plannedAmount: '' }],
        },
  });
  const { register, handleSubmit, control, formState } = form;
  const lines = useFieldArray({ control, name: 'lines' });
  const period = useWatch({ control, name: 'period' });
  const lineValues = useWatch({ control, name: 'lines' }) ?? [];
  const total = safeSum(lineValues.map((l) => l?.plannedAmount ?? ''));

  const mutation = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name,
        fiscalYear: v.fiscalYear,
        period: v.period,
        quarter: v.period === 'QUARTERLY' ? Number(v.quarter) : null,
        businessUnitId: v.businessUnitId || null,
        departmentId: v.departmentId || null,
        projectId: v.projectId || null,
        notes: v.notes || null,
        lines: v.lines.map((l) => ({ category: l.category, description: l.description || null, plannedAmount: l.plannedAmount })),
      };
      return budget ? apiPatch<Budget>(`/finance/budgets/${budget.id}`, body) : apiPost<Budget>('/finance/budgets', body);
    },
    onSuccess: () => {
      toast.success(budget ? '예산을 수정했습니다.' : '예산을 등록했습니다.');
      qc.invalidateQueries({ queryKey: financeKeys.all });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const err = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{budget ? '예산 수정' : '예산 편성'}</DialogTitle>
          <DialogDescription>편성 금액은 항목 합계로 자동 계산됩니다. 승인 금액은 승인 단계에서 별도로 확정됩니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="예산명" htmlFor="b-name" error={err.name?.message}>
              <Input id="b-name" {...register('name')} placeholder="예: 2026 테크 운영 예산" />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="회계연도" htmlFor="b-year" error={err.fiscalYear?.message}>
                <Input id="b-year" type="number" inputMode="numeric" {...register('fiscalYear')} />
              </Field>
              <Field label="기간" htmlFor="b-period">
                <NativeSelect id="b-period" {...register('period')}>
                  <option value="ANNUAL">연간</option>
                  <option value="QUARTERLY">분기</option>
                </NativeSelect>
              </Field>
              <Field label="분기" htmlFor="b-q" error={err.quarter?.message}>
                <NativeSelect id="b-q" {...register('quarter')} disabled={period !== 'QUARTERLY'}>
                  <option value="">-</option>
                  {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}분기</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label="사업 구분" htmlFor="b-unit">
              <NativeSelect id="b-unit" {...register('businessUnitId')}>
                <option value="">선택 안 함</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="부서" htmlFor="b-dept">
              <NativeSelect id="b-dept" {...register('departmentId')}>
                <option value="">선택 안 함</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="프로젝트" htmlFor="b-proj">
              <NativeSelect id="b-proj" {...register('projectId')}>
                <option value="">선택 안 함</option>
                {(projects?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="메모" htmlFor="b-notes">
              <Textarea id="b-notes" rows={1} className="min-h-9" {...register('notes')} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">예산 항목</p>
              <Button type="button" size="sm" variant="outline" onClick={() => lines.append({ category: '', description: '', plannedAmount: '' })} disabled={lines.fields.length >= 200}>
                <Plus /> 항목 추가
              </Button>
            </div>
            <div className="space-y-2">
              {lines.fields.length === 0 && <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">항목이 없습니다. 항목을 추가하세요.</p>}
              {lines.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.2fr_1.5fr_1fr_auto] sm:border-0 sm:p-0">
                  <div className="col-span-2 sm:col-span-1">
                    <Input aria-label={`${i + 1}번 항목명`} placeholder="항목 (예: 인건비)" {...register(`lines.${i}.category`)} />
                    {err.lines?.[i]?.category && <p className="mt-1 text-xs text-danger">{err.lines[i]?.category?.message}</p>}
                  </div>
                  <Input aria-label={`${i + 1}번 설명`} placeholder="설명 (선택)" className="col-span-2 sm:col-span-1" {...register(`lines.${i}.description`)} />
                  <div>
                    <Input aria-label={`${i + 1}번 편성 금액`} placeholder="0" inputMode="decimal" className="text-right tabular-nums" {...register(`lines.${i}.plannedAmount`)} />
                    {err.lines?.[i]?.plannedAmount && <p className="mt-1 text-xs text-danger">{err.lines[i]?.plannedAmount?.message}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${i + 1}번 항목 삭제`} onClick={() => lines.remove(i)}><Trash2 /></Button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-sm">
              편성 합계 <span className="ml-2 font-semibold tabular-nums">{total ? krw(total) : '금액 형식 확인 필요'}</span>
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={mutation.isPending}>{budget ? '저장' : '등록'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
