'use client';
import { EmptyState, PageHeader } from '@/components/admin/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { GrantsManager } from '@/features/settings/grants';
import { PermissionMatrix } from '@/features/settings/permission-matrix';
import { ShieldOff } from 'lucide-react';

export default function PermissionsPage() {
  const can = useCan();
  return (
    <>
      <PageHeader title="역할·권한" description="역할별 기본 권한과 개별 권한 부여를 관리합니다. 모든 변경은 감사 로그에 기록됩니다." />
      {!can('permissions.manage') ? (
        <EmptyState icon={ShieldOff} title="권한 정책을 관리할 권한이 없습니다" description="역할·권한 정책은 최고관리자 또는 권한 관리 권한을 부여받은 사용자만 변경할 수 있습니다." />
      ) : (
        <Tabs defaultValue="matrix">
          <TabsList>
            <TabsTrigger value="matrix">역할 × 권한</TabsTrigger>
            <TabsTrigger value="grants">개별 권한 부여</TabsTrigger>
          </TabsList>
          <TabsContent value="matrix"><PermissionMatrix /></TabsContent>
          <TabsContent value="grants"><GrantsManager /></TabsContent>
        </Tabs>
      )}
    </>
  );
}
