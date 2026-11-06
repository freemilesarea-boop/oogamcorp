'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

export function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/admin') && !raw.startsWith('/admin/login') && !raw.startsWith('/admin/mfa') ? raw : '/admin';
}

export function MfaFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <main className="w-full max-w-sm">
        <p className="mb-8 text-lg font-black tracking-tight">OOGAM</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">{description}</p>
        {children}
        <button
          type="button"
          className="mt-8 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={async () => { await apiPost('/auth/logout').catch(() => undefined); qc.clear(); router.replace('/admin/login'); }}
        >
          다른 계정으로 로그인
        </button>
      </main>
    </div>
  );
}

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3">
      <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        복구 코드는 지금 한 번만 표시됩니다. 인증 앱을 잃어버렸을 때 각 코드를 1회 사용할 수 있으니 안전한 곳에 보관하세요.
      </div>
      <ol className="grid grid-cols-2 gap-1.5 rounded-md bg-muted p-3 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="flex gap-2">
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => navigator.clipboard?.writeText(text)}>복사</button>
        <a className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" download="oogam-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>파일로 저장</a>
      </div>
    </div>
  );
}
