'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { apiGet, apiPut } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

interface Setting<T> { key: string; label: string; value: T; updatedAt: string | null }
type CompanyInfo = { name?: string; legalName?: string; ceo?: string; businessNumber?: string; address?: string; phone?: string; email?: string };
type EmailPrefs = { enabled: boolean; taskDueReminders?: boolean; approvalUpdates?: boolean; announcements?: boolean };

const COMPANY_FIELDS: { key: keyof CompanyInfo; label: string; type?: string }[] = [
  { key: 'name', label: '회사명' }, { key: 'legalName', label: '법인명' }, { key: 'ceo', label: '대표자' },
  { key: 'businessNumber', label: '사업자등록번호' }, { key: 'phone', label: '대표 전화', type: 'tel' }, { key: 'email', label: '대표 이메일', type: 'email' },
  { key: 'address', label: '주소' },
];

/** 시스템 설정 (settings.manage). 허용된 키만 서버에서 저장된다 */
export function SystemSettings() {
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ['settings', 'system', 'company.info'], queryFn: () => apiGet<Setting<CompanyInfo>>('/settings/system/company.info') });
  const email = useQuery({ queryKey: ['settings', 'system', 'notifications.email'], queryFn: () => apiGet<Setting<EmailPrefs>>('/settings/system/notifications.email') });
  const [info, setInfo] = useState<CompanyInfo>({});
  const [prefs, setPrefs] = useState<EmailPrefs>({ enabled: false });
  useEffect(() => { if (company.data) setInfo(company.data.value); }, [company.data]);
  useEffect(() => { if (email.data) setPrefs(email.data.value); }, [email.data]);
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: object }) => {
      const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '' && v !== undefined));
      return apiPut(`/settings/system/${key}`, { value: clean });
    },
    onSuccess: () => { toast.success('설정을 저장했습니다.'); void qc.invalidateQueries({ queryKey: ['settings', 'system'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (company.isLoading || email.isLoading) return <LoadingRows rows={4} />;
  if (company.error || email.error) return <ErrorState error={company.error ?? email.error} />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>회사 정보</CardTitle>
          <CardDescription>{company.data?.updatedAt ? `최종 수정 ${formatDateTime(company.data.updatedAt)}` : '아직 저장된 정보가 없습니다.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ key: 'company.info', value: info }); }}>
            {COMPANY_FIELDS.map((f) => (
              <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2' : undefined}>
                <Field label={f.label} htmlFor={`ci-${f.key}`}>
                  <Input id={`ci-${f.key}`} type={f.type ?? 'text'} value={info[f.key] ?? ''} onChange={(e) => setInfo({ ...info, [f.key]: e.target.value })} />
                </Field>
              </div>
            ))}
            <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={save.isPending && save.variables?.key === 'company.info'}>저장</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>이메일 알림</CardTitle>
          <CardDescription>실제 발송은 서버 환경변수 SMTP_ENABLED=true 와 메일 서버 설정이 있어야 동작합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {([['enabled', '이메일 알림 사용'], ['taskDueReminders', '업무 마감 알림'], ['approvalUpdates', '결재 알림'], ['announcements', '공지 알림']] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <Label htmlFor={`ep-${k}`}>{label}</Label>
              <Switch id={`ep-${k}`} checked={!!prefs[k]} disabled={k !== 'enabled' && !prefs.enabled} onCheckedChange={(v) => setPrefs({ ...prefs, [k]: v })} />
            </div>
          ))}
          <div className="flex justify-end"><Button onClick={() => save.mutate({ key: 'notifications.email', value: prefs })} loading={save.isPending && save.variables?.key === 'notifications.email'}>저장</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
