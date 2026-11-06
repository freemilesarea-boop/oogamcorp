'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Spinner } from '@/components/ui/misc';

const schema = z
  .object({
    name: z.string().min(1, '이름을 입력하세요.').max(100),
    password: z.string().regex(/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/, '10자 이상, 영문과 숫자를 포함하세요.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: '비밀번호가 일치하지 않습니다.' });

function AcceptForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiGet<{ email: string; name: string | null; organization: string; role: string }>('/auth/invitation', { token }),
    enabled: !!token,
    retry: false,
  });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { name: info.data?.name ?? '', password: '', confirm: '' } });

  if (!token) return <p className="text-sm text-muted-foreground">초대 토큰이 없습니다.</p>;
  if (info.isLoading) return <Spinner />;
  if (info.error) return <p role="alert" className="text-sm text-danger">{(info.error as Error).message}</p>;

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        try {
          await api('/auth/accept-invitation', { method: 'POST', json: { token, name: v.name, password: v.password } });
          router.replace('/admin/login');
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <p className="text-sm text-muted-foreground">{info.data?.organization} · {info.data?.role} · {info.data?.email}</p>
      <Field label="이름" error={formState.errors.name?.message}><Input {...register('name')} /></Field>
      <Field label="비밀번호" error={formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
      <Field label="비밀번호 확인" error={formState.errors.confirm?.message}><Input type="password" autoComplete="new-password" {...register('confirm')} /></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>계정 활성화</Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-lg font-black tracking-tight">OOGAM</p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">초대 수락</h1>
        <Suspense><AcceptForm /></Suspense>
      </div>
    </div>
  );
}
