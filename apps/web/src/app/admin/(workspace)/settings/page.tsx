'use client';
import { PageHeader } from '@/components/admin/states';
import { useCan } from '@/lib/auth';
import { isCmsSite } from '@/lib/site-mode';
import { MfaCard, PasswordCard, ProfileCard, SessionsCard } from '@/features/settings/account';
import { SystemSettings } from '@/features/settings/system-settings';

export default function SettingsPage() {
  const can = useCan();
  return (
    <>
      <PageHeader title="내 계정" description="프로필, 비밀번호, 로그인된 기기를 관리합니다." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
        <div className="lg:col-span-2"><SessionsCard /></div>
        <div className="lg:col-span-2"><MfaCard /></div>
      </div>
      {can('settings.manage') && !isCmsSite && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">시스템 설정</h2>
          <SystemSettings />
        </section>
      )}
    </>
  );
}
