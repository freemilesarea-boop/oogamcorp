'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { MfaFrame, RecoveryCodes, safeNext } from '@/features/mfa/shared';

type Step = { kind: 'password' } | { kind: 'scan'; secret: string; qr: string } | { kind: 'codes'; codes: string[] };

function Setup() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (step.kind === 'codes') {
    return (
      <div className="space-y-5">
        <RecoveryCodes codes={step.codes} />
        <Button className="w-full" onClick={() => { qc.clear(); router.replace(safeNext(params.get('next'))); }}>보관했습니다. 계속하기</Button>
      </div>
    );
  }
  if (step.kind === 'scan') {
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await apiPost<{ recoveryCodes: string[] }>('/auth/mfa/enroll/confirm', { code }); setStep({ kind: 'codes', codes: r.recoveryCodes }); }); }}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>인증 앱에서 QR 코드를 스캔하세요.</li>
          <li>앱에 표시된 6자리 코드를 입력하세요.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.qr} alt="인증 앱 등록용 QR 코드" width={200} height={200} className="mx-auto rounded-md border border-border bg-white p-2" />
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">QR 코드를 스캔할 수 없나요? 키 직접 입력</summary>
          <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-foreground" data-testid="mfa-secret">{step.secret}</code>
        </details>
        <Field label="인증 코드" htmlFor="setup-code">
          <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center font-mono text-lg tracking-[0.4em]" />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>등록 완료</Button>
      </form>
    );
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await apiPost<{ secret: string; qrDataUrl: string }>('/auth/mfa/enroll/start', { password }); setPassword(''); setStep({ kind: 'scan', secret: r.secret, qr: r.qrDataUrl }); }); }}>
      <Field label="현재 비밀번호" htmlFor="setup-password" hint="본인 확인을 위해 비밀번호를 다시 입력하세요.">
        <Input id="setup-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" loading={busy} disabled={!password}>다음</Button>
    </form>
  );
}

export default function MfaSetupPage() {
  return (
    <MfaFrame title="2단계 인증 등록" description="관리자 계정은 인증 앱(TOTP) 기반 2단계 인증을 사용합니다.">
      <Suspense><Setup /></Suspense>
    </MfaFrame>
  );
}
