'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

const schema = z.object({
  email: z.string().email('올바른 이메일을 입력하세요.'),
  password: z.string().min(1, '비밀번호를 입력하세요.'),
});

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api<{ mfaRequired?: boolean; mfaEnrollmentRequired?: boolean }>('/auth/login', { method: 'POST', json: values });
      qc.clear();
      const raw = params.get('next');
      const next = raw && raw.startsWith('/admin') && !raw.startsWith('/admin/login') && !raw.startsWith('/admin/mfa') ? raw : '/admin';
      if (r.mfaRequired) router.replace(`/admin/mfa?next=${encodeURIComponent(next)}`);
      else if (r.mfaEnrollmentRequired) router.replace(`/admin/mfa/setup?next=${encodeURIComponent(next)}`);
      else router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="이메일" htmlFor="email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" autoFocus {...register('email')} />
      </Field>
      <Field label="비밀번호" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
      <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>로그인</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <Link href="/" className="text-lg font-black tracking-tight">OOGAM</Link>
        <div>
          <p className="text-5xl font-bold leading-[1.05] tracking-[-0.04em]">Ideas Become<br />Impact.</p>
          <p className="mt-6 max-w-sm text-sm text-gray-400">OOGAM 임직원 전용 워크스페이스입니다. 계정은 관리자 초대를 통해서만 발급됩니다.</p>
        </div>
        <p className="text-xs text-gray-400">© OOGAM. Internal use only.</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <p className="mb-6 text-lg font-black tracking-tight lg:hidden">OOGAM</p>
            <h1 className="text-2xl font-semibold tracking-tight">워크스페이스 로그인</h1>
            <p className="mt-1 text-sm text-muted-foreground">회사 계정으로 로그인하세요.</p>
          </div>
          <Suspense><LoginForm /></Suspense>
          <p className="mt-8 text-xs text-muted-foreground">외부 회원가입은 지원하지 않습니다. 계정이 필요하면 관리자에게 초대를 요청하세요.</p>
        </div>
      </main>
    </div>
  );
}
