'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { UserPicker } from '@/components/admin/user-picker';
import { EmptyState, ErrorState, LoadingRows } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useDepartments } from '@/lib/directory';
import { formatDate } from '@/lib/utils';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';
import { usePermissionCatalog } from './permission-matrix';

interface Grant {
  id: string;
  permission: string;
  label: string;
  sensitive: boolean;
  user: { id: string; name: string; email: string } | null;
  department: { id: string; name: string } | null;
  expiresAt: string | null;
  expired: boolean;
  grantedBy: { id: string; name: string } | null;
  createdAt: string;
}

/** 개별 사용자/부서에 모듈 권한을 명시적으로 추가 부여 (역할과 별개, 만료일 지정 가능) */
export function GrantsManager() {
  const me = useMe();
  const qc = useQueryClient();
  const catalog = usePermissionCatalog();
  const { data: departments = [] } = useDepartments();
  const list = useQuery({ queryKey: ['settings', 'grants'], queryFn: () => apiGet<Grant[]>('/settings/grants') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ permission: '', target: 'user' as 'user' | 'department', userId: '', departmentId: '', expiresAt: '' });
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const isOwner = me.role.key === 'OWNER';
  const options = (catalog.data ?? []).filter((p) => isOwner || (!p.sensitive && (me.permissions as string[]).includes(p.key)));

  const create = useMutation({
    mutationFn: () => apiPost('/settings/grants', {
      permission: form.permission,
      userId: form.target === 'user' ? form.userId : undefined,
      departmentId: form.target === 'department' ? form.departmentId : undefined,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59+09:00`).toISOString() : undefined,
    }),
    onSuccess: () => {
      toast.success('권한을 부여했습니다.');
      void qc.invalidateQueries({ queryKey: ['settings', 'grants'] });
      setOpen(false);
      setForm({ permission: '', target: 'user', userId: '', departmentId: '', expiresAt: '' });
    },
    onError: (e) => setError((e as Error).message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/settings/grants/${id}`),
    onSuccess: () => { toast.success('권한 부여를 철회했습니다.'); void qc.invalidateQueries({ queryKey: ['settings', 'grants'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">역할과 별도로 특정 사용자·부서에 권한을 추가합니다. 예: 경영진 1인에게 급여 열람 권한(hr.sensitive.read) 부여</p>
        <Button size="sm" onClick={() => { setError(null); setOpen(true); }}><Plus />권한 부여</Button>
      </div>
      {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? (
        <EmptyState icon={KeyRound} title="명시적으로 부여된 권한이 없습니다" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>권한</TH>
              <TH>대상</TH>
              <TH className="hidden md:table-cell">부여자</TH>
              <TH>만료</TH>
              <TH className="w-12"><span className="sr-only">작업</span></TH>
            </TR>
          </THead>
          <TBody>
            {list.data.map((g) => (
              <TR key={g.id} className={g.expired ? 'opacity-60' : undefined}>
                <TD>
                  <span className="flex items-center gap-1.5">{g.label}{g.sensitive && <Badge variant="danger">민감</Badge>}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{g.permission}</span>
                </TD>
                <TD>{g.user ? <><span className="block">{g.user.name}</span><span className="block text-xs text-muted-foreground">{g.user.email}</span></> : <Badge variant="muted">부서 · {g.department?.name}</Badge>}</TD>
                <TD className="hidden text-muted-foreground md:table-cell">{g.grantedBy?.name ?? '-'} · {formatDate(g.createdAt)}</TD>
                <TD>{g.expired ? <Badge variant="muted">만료됨</Badge> : g.expiresAt ? formatDate(g.expiresAt) : <span className="text-muted-foreground">무기한</span>}</TD>
                <TD>
                  {(isOwner || !g.sensitive) && (
                    <Button variant="ghost" size="icon-sm" aria-label="권한 철회" onClick={() => setRevoking(g)}><Trash2 /></Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>권한 부여</DialogTitle>
            <DialogDescription>{isOwner ? '민감 권한 부여는 감사 로그에 기록됩니다.' : '민감 권한은 최고관리자만 부여할 수 있습니다.'}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            if (!form.permission) return setError('권한을 선택하세요.');
            if (form.target === 'user' ? !form.userId : !form.departmentId) return setError('대상을 선택하세요.');
            setError(null);
            create.mutate();
          }}>
            <Field label="권한" htmlFor="grant-perm">
              <NativeSelect id="grant-perm" value={form.permission} onChange={(e) => setForm({ ...form, permission: e.target.value })}>
                <option value="">선택</option>
                {options.map((p) => <option key={p.key} value={p.key}>{p.sensitive ? '[민감] ' : ''}{p.label} ({p.key})</option>)}
              </NativeSelect>
            </Field>
            <Field label="대상 유형" htmlFor="grant-target">
              <NativeSelect id="grant-target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value as 'user' | 'department' })}>
                <option value="user">사용자</option>
                <option value="department">부서 전체</option>
              </NativeSelect>
            </Field>
            {form.target === 'user' ? (
              <Field label="사용자"><UserPicker multiple={false} value={form.userId ? [form.userId] : []} onChange={(ids) => setForm({ ...form, userId: ids[0] ?? '' })} /></Field>
            ) : (
              <Field label="부서" htmlFor="grant-dept">
                <NativeSelect id="grant-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">선택</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="만료일 (선택)" htmlFor="grant-exp" hint="비워 두면 철회할 때까지 유지됩니다.">
              <Input id="grant-exp" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button type="submit" loading={create.isPending}>부여</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="권한 부여를 철회할까요?"
        description={revoking ? `${revoking.user?.name ?? revoking.department?.name}의 ‘${revoking.label}’ 권한이 즉시 해제됩니다.` : undefined}
        confirmLabel="철회"
        onConfirm={async () => { if (revoking) await revoke.mutateAsync(revoking.id); }}
      />
    </div>
  );
}
