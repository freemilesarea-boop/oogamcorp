'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { RecoveryCodes } from '@/features/mfa/shared';

export function ProfileCard() {
  const me = useMe();
  return (
    <Card>
      <CardHeader>
        <CardTitle>프로필</CardTitle>
        <CardDescription>이름·부서·직책 변경은 관리자에게 요청하세요.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Avatar name={me.user.name} src={me.user.avatarUrl} className="size-14 text-base" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{me.user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{me.user.email}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">조직</dt><dd>{me.organization.name}</dd>
          <dt className="text-muted-foreground">역할</dt><dd><Badge variant="outline">{me.role.name}</Badge></dd>
          <dt className="text-muted-foreground">부서</dt><dd>{me.department?.name ?? '-'}</dd>
          <dt className="text-muted-foreground">직책</dt><dd>{me.title ?? '-'}</dd>
          <dt className="text-muted-foreground">최근 로그인</dt><dd>{me.user.lastLoginAt ? formatDateTime(me.user.lastLoginAt) : '-'}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요.'),
    newPassword: z.string().regex(/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/, '10자 이상, 영문과 숫자를 모두 포함하세요.'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: '새 비밀번호가 일치하지 않습니다.' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: '기존 비밀번호와 달라야 합니다.' });
type PwForm = z.infer<typeof pwSchema>;

export function PasswordCard() {
  const qc = useQueryClient();
  const form = useForm<PwForm>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const change = useMutation({
    mutationFn: (v: PwForm) => apiPost('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      toast.success('비밀번호를 변경했습니다. 다른 기기의 세션은 모두 로그아웃되었습니다.');
      form.reset();
      void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => form.setError('currentPassword', { message: (e as Error).message }),
  });
  const err = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>비밀번호 변경</CardTitle>
        <CardDescription>변경하면 현재 기기를 제외한 모든 세션이 종료됩니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate>
          <Field label="현재 비밀번호" htmlFor="pw-cur" error={err.currentPassword?.message}>
            <Input id="pw-cur" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
          </Field>
          <Field label="새 비밀번호" htmlFor="pw-new" error={err.newPassword?.message} hint="10자 이상, 영문과 숫자 포함">
            <Input id="pw-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="새 비밀번호 확인" htmlFor="pw-confirm" error={err.confirm?.message}>
            <Input id="pw-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <div className="flex justify-end"><Button type="submit" loading={change.isPending}>변경</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }

function describeAgent(ua: string | null): string {
  if (!ua) return '알 수 없는 기기';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '브라우저';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

export function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => apiGet<SessionRow[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/auth/sessions/${id}`),
    onSuccess: () => { toast.success('세션을 종료했습니다.'); void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>로그인된 기기</CardTitle>
        <CardDescription>알 수 없는 기기가 있다면 즉시 세션을 종료하고 비밀번호를 변경하세요. 현재 사용 중인 세션을 종료하면 로그아웃됩니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isLoading ? <LoadingRows rows={2} /> : sessions.error ? <ErrorState error={sessions.error} /> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-3">
                <Laptop className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {describeAgent(s.userAgent)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={`로그인 ${formatDateTime(s.createdAt)} · 만료 ${formatDateTime(s.expiresAt)}`}>
                    {s.ip ?? 'IP 미상'} · 최근 활동 {timeAgo(s.lastSeenAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}><LogOut />종료</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function MfaCard() {
  const me = useMe();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['mfa'], queryFn: () => apiGet<{ enabled: boolean; enrolledAt: string | null; required: boolean; recoveryCodesRemaining: number }>('/auth/mfa') });
  const [mode, setMode] = useState<'none' | 'disable' | 'regen'>('none');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = status.data;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'disable') {
        await apiPost('/auth/mfa/disable', { password, code });
        toast.success('2단계 인증을 해제했습니다. 다른 기기의 세션은 로그아웃되었습니다.');
      } else {
        const r = await apiPost<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { password, code });
        setCodes(r.recoveryCodes);
      }
      setMode('none');
      setPassword('');
      setCode('');
      qc.invalidateQueries({ queryKey: ['mfa'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />2단계 인증 (MFA)</CardTitle>
        <CardDescription>
          {status.isLoading ? '확인 중…' : s?.enabled ? `사용 중 · 남은 복구 코드 ${s.recoveryCodesRemaining}개` : '사용 안 함'}
          {s?.required && ' · 역할 정책상 필수'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.error && <ErrorState error={status.error} />}
        {codes && <RecoveryCodes codes={codes} />}
        {s && !s.enabled && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">인증 앱(Google Authenticator, Microsoft Authenticator, 1Password 등)으로 로그인 시 6자리 코드를 추가로 확인합니다.</p>
            <Button asChild size="sm"><Link href="/admin/mfa/setup?next=/admin/settings">2단계 인증 설정</Link></Button>
          </div>
        )}
        {s?.enabled && mode === 'none' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setMode('regen')}>복구 코드 재발급</Button>
            {!s.required && <Button size="sm" variant="outline" className="text-danger" onClick={() => setMode('disable')}>2단계 인증 해제</Button>}
          </div>
        )}
        {mode !== 'none' && (
          <form onSubmit={submit} className="max-w-sm space-y-3">
            <p className="text-sm font-medium">{mode === 'disable' ? '2단계 인증 해제' : '복구 코드 재발급 (기존 코드는 무효화)'}</p>
            <Field label="현재 비밀번호" htmlFor="mfa-pw"><Input id="mfa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="인증 코드" htmlFor="mfa-cd"><Input id="mfa-cd" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy} disabled={!password || code.length !== 6} variant={mode === 'disable' ? 'danger' : 'default'}>확인</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setMode('none'); setError(null); }}>취소</Button>
            </div>
          </form>
        )}
        <p className="text-xs text-muted-foreground">로그인 계정: {me.user.email}. 인증 기기를 분실했고 복구 코드도 없다면 최고관리자에게 MFA 초기화를 요청하세요.</p>
      </CardContent>
    </Card>
  );
}
