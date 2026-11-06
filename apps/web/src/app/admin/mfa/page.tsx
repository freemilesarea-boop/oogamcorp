'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/api';
import { MfaFrame, safeNext } from '@/features/mfa/shared';

function VerifyForm() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/auth/mfa/verify', useRecovery ? { recoveryCode: value.trim() } : { code: value.trim() });
      qc.clear();
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/admin/login');
        return;
      }
      setError((err as Error).message);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {useRecovery ? (
        <Field label="복구 코드" htmlFor="mfa-recovery">
          <Input id="mfa-recovery" autoComplete="off" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" />
        </Field>
      ) : (
        <Field label="인증 코드" htmlFor="mfa-code" hint="인증 앱(Google Authenticator 등)에 표시된 6자리 숫자">
          <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} className="text-center font-mono text-lg tracking-[0.4em]" />
        </Field>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
      <Button type="submit" className="w-full" size="lg" loading={busy} disabled={useRecovery ? value.trim().length < 8 : value.length !== 6}>확인</Button>
      <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setUseRecovery((v) => !v); setValue(''); setError(null); }}>
        {useRecovery ? '인증 코드 사용' : '인증 앱을 사용할 수 없나요? 복구 코드 사용'}
      </button>
    </form>
  );
}

export default function MfaVerifyPage() {
  return (
    <MfaFrame title="2단계 인증" description="계정 보호를 위해 인증 앱의 코드를 입력하세요.">
      <Suspense><VerifyForm /></Suspense>
    </MfaFrame>
  );
}
