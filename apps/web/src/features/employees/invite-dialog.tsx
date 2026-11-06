'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useDepartments } from '@/lib/directory';
import { InviteLinkBox } from './invite-link';
import type { InviteResult, RoleLite } from './types';

const schema = z.object({
  email: z.string().trim().email('올바른 이메일을 입력하세요.').max(254),
  name: z.string().trim().max(100).optional(),
  roleId: z.string().uuid('역할을 선택하세요.'),
  departmentId: z.string().optional(),
  title: z.string().trim().max(100).optional(),
});
type Form = z.infer<typeof schema>;

export function InviteDialog({ roles }: { roles: RoleLite[] }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: departments = [] } = useDepartments();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const myRank = roles.find((r) => r.key === me.role.key)?.rank ?? 0;
  // 자신보다 높은 역할 / (OWNER 가 아니면) OWNER 역할은 선택지에서 제외 — 서버도 동일 규칙을 강제
  const assignable = roles.filter((r) => r.rank <= myRank && (r.key !== 'OWNER' || me.role.key === 'OWNER'));
  const defaultRole = assignable.find((r) => r.key === 'EMPLOYEE')?.id ?? '';
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '', name: '', roleId: defaultRole, departmentId: '', title: '' } });
  const invite = useMutation({
    mutationFn: (v: Form) => apiPost<InviteResult>('/employees/invitations', {
      email: v.email, roleId: v.roleId, name: v.name || undefined, departmentId: v.departmentId || undefined, title: v.title || undefined,
    }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const reset = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setResult(null);
      setError(null);
      form.reset({ email: '', name: '', roleId: defaultRole, departmentId: '', title: '' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus />직원 초대</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result ? '초대 링크가 생성되었습니다' : '직원 초대'}</DialogTitle>
          <DialogDescription>{result ? '아래 링크를 초대 대상자에게 전달하세요.' : '초대 받은 사람은 링크에서 이름과 비밀번호를 설정해 계정을 활성화합니다.'}</DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <InviteLinkBox result={result} />
            <DialogFooter><Button onClick={() => reset(false)}>완료</Button></DialogFooter>
          </>
        ) : (
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setError(null); invite.mutate(v); })} noValidate>
            <Field label="이메일" htmlFor="inv-email" error={form.formState.errors.email?.message}>
              <Input id="inv-email" type="email" autoComplete="off" {...form.register('email')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="이름 (선택)" htmlFor="inv-name"><Input id="inv-name" {...form.register('name')} /></Field>
              <Field label="직책 (선택)" htmlFor="inv-title"><Input id="inv-title" {...form.register('title')} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="역할" htmlFor="inv-role" error={form.formState.errors.roleId?.message}>
                <NativeSelect id="inv-role" {...form.register('roleId')}>
                  <option value="">선택</option>
                  {assignable.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.key})</option>)}
                </NativeSelect>
              </Field>
              <Field label="부서 (선택)" htmlFor="inv-dept">
                <NativeSelect id="inv-dept" {...form.register('departmentId')}>
                  <option value="">미지정</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </Field>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => reset(false)}>취소</Button>
              <Button type="submit" loading={invite.isPending}>초대 링크 만들기</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
