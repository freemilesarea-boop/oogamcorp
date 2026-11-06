'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, type Priority, type ProjectStatus, type TaskStatus } from '@oogam/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { Avatar, Checkbox } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useDepartments } from '@/lib/directory';
import { formatDate, formatDateTime, timeAgo, toDateInput } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import { HrPanel } from './hr-panel';
import { Sheet } from './sheet';
import { ACCOUNT_LABELS, EMPLOYMENT_LABELS, type EmployeeDetail, type EmploymentStatus, type RoleLite } from './types';

const ACTION_LABELS: Record<string, string> = {
  'project.created': '프로젝트 생성', 'project.updated': '프로젝트 수정', 'project.member.added': '구성원 추가',
  'task.created': '업무 생성', 'task.updated': '업무 수정', 'task.status.changed': '상태 변경', 'task.deleted': '업무 삭제',
};

export function EmployeeSheet({ userId, roles, onClose }: { userId: string | null; roles: RoleLite[]; onClose: () => void }) {
  const can = useCan();
  const q = useQuery({
    queryKey: ['employees', userId],
    queryFn: () => apiGet<EmployeeDetail>(`/employees/${userId}`),
    enabled: !!userId,
  });
  const e = q.data;
  return (
    <Sheet
      open={!!userId}
      onOpenChange={(o) => !o && onClose()}
      title={e ? <span className="flex items-center gap-2.5"><Avatar name={e.name} src={e.avatarUrl} className="size-8" />{e.name}</span> : '직원 정보'}
      description={e ? `${e.email}${e.title ? ` · ${e.title}` : ''}` : undefined}
    >
      {q.isLoading ? <LoadingRows rows={6} /> : q.error ? <ErrorState error={q.error} /> : e && (
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">개요</TabsTrigger>
            <TabsTrigger value="work">업무 {e.openTaskCount > 0 && <span className="tabular-nums text-muted-foreground">{e.openTaskCount}</span>}</TabsTrigger>
            <TabsTrigger value="activity">활동</TabsTrigger>
            {can('hr.sensitive.read') && <TabsTrigger value="hr">인사정보</TabsTrigger>}
          </TabsList>
          <TabsContent value="overview"><Overview e={e} roles={roles} /></TabsContent>
          <TabsContent value="work"><Work e={e} /></TabsContent>
          <TabsContent value="activity">
            {e.recentActivity.length === 0 ? <EmptyState title="표시할 활동이 없습니다" description="내가 볼 수 있는 프로젝트의 활동만 표시됩니다." /> : (
              <ol className="relative space-y-4 border-l border-border pl-4">
                {e.recentActivity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-foreground" aria-hidden />
                    <p><span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>{a.label && <span className="text-muted-foreground"> · {a.label}</span>}</p>
                    <p className="text-xs text-muted-foreground" title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
          {can('hr.sensitive.read') && <TabsContent value="hr"><HrPanel userId={e.id} /></TabsContent>}
        </Tabs>
      )}
    </Sheet>
  );
}

function Overview({ e, roles }: { e: EmployeeDetail; roles: RoleLite[] }) {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const { data: departments = [] } = useDepartments();
  const canManage = can('employees.manage');
  const myRank = roles.find((r) => r.key === me.role.key)?.rank ?? 0;
  const isSelf = e.id === me.user.id;
  const outranked = e.role.rank > myRank;
  const editable = canManage && !outranked;
  const [form, setForm] = useState({ title: '', departmentId: '', hireDate: '', employeeNumber: '', phone: '', employmentStatus: 'ACTIVE' as EmploymentStatus });
  const [roleId, setRoleId] = useState(e.role.id);
  const [confirm, setConfirm] = useState<'deactivate' | null>(null);
  const [resign, setResign] = useState(false);
  useEffect(() => {
    setForm({ title: e.title ?? '', departmentId: e.department?.id ?? '', hireDate: toDateInput(e.hireDate), employeeNumber: e.employeeNumber ?? '', phone: e.phone ?? '', employmentStatus: e.employmentStatus });
    setRoleId(e.role.id);
  }, [e]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['employees'] });
  const onErr = (err: unknown) => toast.error((err as Error).message);
  const save = useMutation({
    mutationFn: () => apiPatch(`/employees/${e.id}`, {
      title: form.title || null, departmentId: form.departmentId || null, hireDate: form.hireDate || null,
      employeeNumber: form.employeeNumber || null, phone: form.phone || null, employmentStatus: form.employmentStatus,
    }),
    onSuccess: () => { toast.success('직원 정보를 저장했습니다.'); refresh(); },
    onError: onErr,
  });
  const changeRole = useMutation({
    mutationFn: () => apiPut(`/employees/${e.id}/role`, { roleId }),
    onSuccess: () => { toast.success('역할을 변경했습니다.'); refresh(); },
    onError: (err) => { onErr(err); setRoleId(e.role.id); },
  });
  const deactivate = useMutation({
    mutationFn: () => apiPost<{ revokedSessions: number }>(`/employees/${e.id}/deactivate`, { resign }),
    onSuccess: (r) => { toast.success(`계정을 비활성화했습니다. (세션 ${r.revokedSessions}개 종료)`); refresh(); },
    onError: onErr,
  });
  const reactivate = useMutation({
    mutationFn: () => apiPost(`/employees/${e.id}/reactivate`),
    onSuccess: () => { toast.success('계정을 다시 활성화했습니다.'); refresh(); },
    onError: onErr,
  });
  const assignable = roles.filter((r) => r.rank <= myRank && (r.key !== 'OWNER' || me.role.key === 'OWNER'));

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">역할</dt><dd><Badge variant="outline">{e.role.name}</Badge></dd>
        <dt className="text-muted-foreground">부서</dt><dd>{e.department?.name ?? '-'}</dd>
        <dt className="text-muted-foreground">재직 상태</dt><dd>{EMPLOYMENT_LABELS[e.employmentStatus]}</dd>
        <dt className="text-muted-foreground">계정</dt><dd><Badge variant={e.accountStatus === 'ACTIVE' ? 'success' : e.accountStatus === 'DISABLED' ? 'danger' : 'muted'}>{ACCOUNT_LABELS[e.accountStatus]}</Badge></dd>
        <dt className="text-muted-foreground">입사일</dt><dd>{formatDate(e.hireDate)}</dd>
        <dt className="text-muted-foreground">최근 로그인</dt><dd>{e.lastLoginAt ? formatDateTime(e.lastLoginAt) : '-'}</dd>
        {canManage && <><dt className="text-muted-foreground">사번</dt><dd>{e.employeeNumber || '-'}</dd><dt className="text-muted-foreground">연락처</dt><dd>{e.phone || '-'}</dd></>}
      </dl>

      {canManage && outranked && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">자신보다 높은 역할의 사용자는 변경할 수 없습니다.</p>}

      {editable && (
        <>
          <section className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">역할</h3>
            <div className="flex gap-2">
              <NativeSelect value={roleId} onChange={(ev) => setRoleId(ev.target.value)} disabled={isSelf} aria-label="역할 선택">
                {!assignable.some((r) => r.id === e.role.id) && <option value={e.role.id}>{e.role.name}</option>}
                {assignable.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.key})</option>)}
              </NativeSelect>
              <Button variant="outline" disabled={isSelf || roleId === e.role.id} loading={changeRole.isPending} onClick={() => changeRole.mutate()}>변경</Button>
            </div>
            {isSelf && <p className="text-xs text-muted-foreground">본인의 역할은 변경할 수 없습니다.</p>}
          </section>

          <form className="space-y-3 border-t border-border pt-5" onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}>
            <h3 className="text-sm font-semibold">인사 기본 정보</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="직책" htmlFor="emp-title"><Input id="emp-title" value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} /></Field>
              <Field label="부서" htmlFor="emp-dept">
                <NativeSelect id="emp-dept" value={form.departmentId} onChange={(ev) => setForm({ ...form, departmentId: ev.target.value })}>
                  <option value="">미지정</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="입사일" htmlFor="emp-hire"><Input id="emp-hire" type="date" value={form.hireDate} onChange={(ev) => setForm({ ...form, hireDate: ev.target.value })} /></Field>
              <Field label="재직 상태" htmlFor="emp-status">
                <NativeSelect id="emp-status" value={form.employmentStatus} onChange={(ev) => setForm({ ...form, employmentStatus: ev.target.value as EmploymentStatus })} disabled={isSelf}>
                  {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="사번" htmlFor="emp-no"><Input id="emp-no" value={form.employeeNumber} onChange={(ev) => setForm({ ...form, employeeNumber: ev.target.value })} /></Field>
              <Field label="연락처" htmlFor="emp-phone"><Input id="emp-phone" type="tel" value={form.phone} onChange={(ev) => setForm({ ...form, phone: ev.target.value })} /></Field>
            </div>
            <div className="flex justify-end"><Button type="submit" loading={save.isPending}>저장</Button></div>
          </form>

          {!isSelf && (
            <section className="space-y-2 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">계정 상태</h3>
              {e.accountStatus === 'DISABLED' ? (
                <Button variant="outline" onClick={() => reactivate.mutate()} loading={reactivate.isPending}>계정 재활성화</Button>
              ) : e.accountStatus === 'ACTIVE' ? (
                <Button variant="danger" onClick={() => setConfirm('deactivate')}>계정 비활성화</Button>
              ) : <p className="text-sm text-muted-foreground">초대 수락 대기 중인 계정입니다.</p>}
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`${e.name} 님의 계정을 비활성화할까요?`}
        description="즉시 모든 기기에서 로그아웃되며 다시 로그인할 수 없습니다. 작성한 문서·업무 기록은 유지됩니다."
        confirmLabel="비활성화"
        onConfirm={() => deactivate.mutateAsync()}
      >
        <div className="flex items-center gap-2">
          <Checkbox id="resign" checked={resign} onCheckedChange={(v) => setResign(v === true)} />
          <Label htmlFor="resign">퇴사 처리 (재직 상태를 ‘퇴사’로 변경)</Label>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function Work({ e }: { e: EmployeeDetail }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">참여 프로젝트</h3>
        {e.projects.length === 0 ? <p className="text-sm text-muted-foreground">볼 수 있는 참여 프로젝트가 없습니다.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {e.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/projects/${p.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                  <span className="min-w-0 truncate"><span className="mr-2 font-mono text-xs text-muted-foreground">{p.key}</span>{p.name}</span>
                  <Badge variant="muted">{PROJECT_STATUS_LABELS[p.status as ProjectStatus] ?? p.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">진행 중 업무 <span className="tabular-nums text-muted-foreground">{e.openTaskCount}</span></h3>
        {e.openTasks.length === 0 ? <p className="text-sm text-muted-foreground">볼 수 있는 진행 중 업무가 없습니다.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {e.openTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.project?.name ?? '개인 업무'} · {TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <Badge variant={t.priority === 'URGENT' ? 'danger' : t.priority === 'HIGH' ? 'warning' : 'muted'}>{PRIORITY_LABELS[t.priority as Priority] ?? t.priority}</Badge>
                  <span className="tabular-nums text-muted-foreground">{t.dueDate ? formatDate(t.dueDate, { month: '2-digit', day: '2-digit' }) : '-'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
