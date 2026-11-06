'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiGet, apiPut } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import type { HrRecord } from './types';

const won = (v: string | null) => (v ? `${new Intl.NumberFormat('ko-KR').format(Number(v.split('.')[0]))}원${v.endsWith('.00') ? '' : ` (${v})`}` : '-');

/** 민감 인사정보 (hr.sensitive.read / write). 열람 시 서버가 감사 로그를 남긴다 */
export function HrPanel({ userId }: { userId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const canWrite = can('hr.sensitive.write');
  const q = useQuery({ queryKey: ['employees', userId, 'hr'], queryFn: () => apiGet<HrRecord>(`/employees/${userId}/hr`), staleTime: 0, gcTime: 0 });
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ annualSalary: '', salaryNote: '', bankAccount: '', emergencyInfo: '' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setForm({ annualSalary: q.data.annualSalary ?? '', salaryNote: q.data.salaryNote ?? '', bankAccount: q.data.bankAccount ?? '', emergencyInfo: q.data.emergencyInfo ?? '' });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => apiPut<HrRecord>(`/employees/${userId}/hr`, {
      annualSalary: form.annualSalary.trim() === '' ? null : form.annualSalary.trim().replace(/,/g, ''),
      salaryNote: form.salaryNote || null,
      bankAccount: form.bankAccount || null,
      emergencyInfo: form.emergencyInfo || null,
    }),
    onSuccess: (r) => {
      qc.setQueryData(['employees', userId, 'hr'], r);
      setEdit(false);
      toast.success('인사정보를 저장했습니다.');
    },
    onError: (e) => setErr((e as Error).message),
  });

  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error) return <ErrorState error={q.error} />;
  const r = q.data!;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        <p>민감 인사정보입니다. 열람·수정 내역은 감사 로그에 기록됩니다. 화면 공유·캡처에 주의하세요.</p>
      </div>
      {edit ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
          <Field label="연봉 (원)" htmlFor="hr-salary" hint="숫자만 입력 (소수 둘째 자리까지)">
            <Input id="hr-salary" inputMode="decimal" value={form.annualSalary} onChange={(e) => setForm({ ...form, annualSalary: e.target.value })} />
          </Field>
          <Field label="급여 메모" htmlFor="hr-note"><Textarea id="hr-note" value={form.salaryNote} onChange={(e) => setForm({ ...form, salaryNote: e.target.value })} /></Field>
          <Field label="급여 계좌" htmlFor="hr-bank"><Input id="hr-bank" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} /></Field>
          <Field label="비상 연락처" htmlFor="hr-emg"><Textarea id="hr-emg" value={form.emergencyInfo} onChange={(e) => setForm({ ...form, emergencyInfo: e.target.value })} /></Field>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEdit(false)}>취소</Button>
            <Button type="submit" loading={save.isPending}>저장</Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">연봉</dt><dd className="tabular-nums">{won(r.annualSalary)}</dd>
            <dt className="text-muted-foreground">급여 메모</dt><dd className="whitespace-pre-wrap">{r.salaryNote || '-'}</dd>
            <dt className="text-muted-foreground">급여 계좌</dt><dd>{r.bankAccount || '-'}</dd>
            <dt className="text-muted-foreground">비상 연락처</dt><dd className="whitespace-pre-wrap">{r.emergencyInfo || '-'}</dd>
            <dt className="text-muted-foreground">최종 수정</dt><dd>{r.updatedAt ? formatDateTime(r.updatedAt) : '기록 없음'}</dd>
          </dl>
          {canWrite && <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => setEdit(true)}>수정</Button></div>}
        </>
      )}
    </div>
  );
}
