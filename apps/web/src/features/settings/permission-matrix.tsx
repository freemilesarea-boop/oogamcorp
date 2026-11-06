'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Checkbox, Tooltip } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';

export interface PermissionMeta { key: string; module: string; label: string; sensitive: boolean }
export interface RoleRow { id: string; key: string; name: string; description: string | null; isSystem: boolean; rank: number; permissions: string[]; memberCount: number; editable: boolean }

const MODULE_LABELS: Record<string, string> = {
  workspace: '워크스페이스', docs: '문서', databases: '데이터베이스', projects: '프로젝트·업무', calendar: '캘린더', approvals: '전자결재',
  finance: '재무', employees: '직원·인사', teams: '부서', announcements: '공지', files: '파일', cms: '홈페이지 CMS', settings: '설정·보안',
};

export function usePermissionCatalog() {
  return useQuery({ queryKey: ['settings', 'permissions'], queryFn: () => apiGet<PermissionMeta[]>('/settings/permissions'), staleTime: 10 * 60_000 });
}

/** 역할 × 권한 매트릭스. 변경 사항은 역할별로 모아 저장한다 */
export function PermissionMatrix() {
  const me = useMe();
  const qc = useQueryClient();
  const catalog = usePermissionCatalog();
  const roles = useQuery({ queryKey: ['settings', 'roles'], queryFn: () => apiGet<RoleRow[]>('/settings/roles') });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const isOwner = me.role.key === 'OWNER';

  useEffect(() => {
    if (roles.data) setDraft(Object.fromEntries(roles.data.map((r) => [r.id, new Set(r.permissions)])));
  }, [roles.data]);

  const grouped = useMemo(() => {
    const m = new Map<string, PermissionMeta[]>();
    for (const p of catalog.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalog.data]);

  const changedRoles = (roles.data ?? []).filter((r) => {
    const d = draft[r.id];
    return d && (d.size !== r.permissions.length || r.permissions.some((k) => !d.has(k)));
  });

  const save = useMutation({
    mutationFn: async () => {
      for (const r of changedRoles) await apiPut(`/settings/roles/${r.id}/permissions`, { permissions: [...draft[r.id]] });
    },
    onSuccess: () => { toast.success('권한 정책을 저장했습니다. 변경 사항은 즉시 적용됩니다.'); void qc.invalidateQueries({ queryKey: ['settings', 'roles'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => { toast.error((e as Error).message); void qc.invalidateQueries({ queryKey: ['settings', 'roles'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/settings/roles/${id}`),
    onSuccess: () => { toast.success('역할을 삭제했습니다.'); void qc.invalidateQueries({ queryKey: ['settings', 'roles'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (catalog.isLoading || roles.isLoading) return <LoadingRows rows={10} />;
  if (catalog.error || roles.error) return <ErrorState error={catalog.error ?? roles.error} />;
  const roleList = roles.data!;

  const cellDisabled = (r: RoleRow, p: PermissionMeta) => {
    if (!r.editable) return '편집 권한이 없는 역할입니다 (자신보다 낮은 서열의 역할만 편집 가능).';
    if (r.key === 'OWNER') return '최고관리자 권한은 축소할 수 없습니다.';
    if (p.sensitive && !isOwner) return '민감 권한은 최고관리자만 변경할 수 있습니다.';
    if (!isOwner && !(me.permissions as string[]).includes(p.key) && !draft[r.id]?.has(p.key)) return '보유하지 않은 권한은 부여할 수 없습니다.';
    return null;
  };
  const toggle = (roleId: string, key: string, on: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev[roleId]);
      if (on) next.add(key);
      else next.delete(key);
      return { ...prev, [roleId]: next };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldAlert className="size-4 text-accent" />
          <span><span className="font-medium text-foreground">민감</span> 표시 권한(급여·재무·감사 등)은 최고관리자만 변경할 수 있습니다.</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}><Plus />사용자 정의 역할</Button>
          <Button variant="ghost" size="sm" disabled={!changedRoles.length || save.isPending} onClick={() => setDraft(Object.fromEntries(roleList.map((r) => [r.id, new Set(r.permissions)])))}><RotateCcw />되돌리기</Button>
          <Button size="sm" disabled={!changedRoles.length} loading={save.isPending} onClick={() => save.mutate()}><Save />저장{changedRoles.length ? ` (${changedRoles.length})` : ''}</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border">
              <th scope="col" className="sticky left-0 z-20 min-w-64 bg-background px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">권한</th>
              {roleList.map((r) => (
                <th key={r.id} scope="col" className="px-2 py-2.5 text-center align-bottom">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[13px] font-semibold">{r.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{r.key} · {r.rank}</span>
                    <span className="text-[10px] text-muted-foreground">{r.memberCount}명</span>
                    {!r.isSystem && r.editable && (
                      <button type="button" className="mt-0.5 text-muted-foreground hover:text-danger" aria-label={`${r.name} 역할 삭제`} onClick={() => setDeleting(r)}><Trash2 className="size-3.5" /></button>
                    )}
                    {!r.editable && <Lock className="mt-0.5 size-3 text-muted-foreground" aria-label="편집 불가" />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([module, perms]) => (
              <Fragment key={module}>
                <tr className="bg-muted/50">
                  <th colSpan={roleList.length + 1} scope="colgroup" className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{MODULE_LABELS[module] ?? module}</th>
                </tr>
                {perms.map((p) => (
                  <tr key={p.key} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <th scope="row" className="sticky left-0 bg-background px-3 py-2 text-left font-normal">
                      <span className="flex items-center gap-1.5">
                        {p.label}
                        {p.sensitive && <Badge variant="danger">민감</Badge>}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">{p.key}</span>
                    </th>
                    {roleList.map((r) => {
                      const reason = cellDisabled(r, p);
                      const checked = draft[r.id]?.has(p.key) ?? false;
                      const dirty = checked !== r.permissions.includes(p.key);
                      const box = (
                        <span className={cn('inline-flex rounded p-1', dirty && 'bg-amber-100 dark:bg-amber-950')}>
                          <Checkbox checked={checked} disabled={!!reason} onCheckedChange={(v) => toggle(r.id, p.key, v === true)} aria-label={`${r.name} — ${p.label}`} />
                        </span>
                      );
                      return (
                        <td key={r.id} className="px-2 py-2 text-center">
                          {reason ? <Tooltip content={reason} side="top">{box}</Tooltip> : box}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} myRank={roleList.find((r) => r.key === me.role.key)?.rank ?? 0} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="역할을 삭제할까요?"
        description={deleting ? `‘${deleting.name}’ 역할을 삭제합니다. 사용 중인 구성원이 있으면 삭제할 수 없습니다.` : undefined}
        confirmLabel="삭제"
        onConfirm={async () => { if (deleting) await del.mutateAsync(deleting.id); }}
      />
    </div>
  );
}

function CreateRoleDialog({ open, onOpenChange, myRank }: { open: boolean; onOpenChange: (o: boolean) => void; myRank: number }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: '', name: '', description: '', rank: '30' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => apiPost('/settings/roles', { key: form.key.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim() || undefined, rank: Number(form.rank), permissions: ['workspace.access'] }),
    onSuccess: () => {
      toast.success('역할을 만들었습니다. 매트릭스에서 권한을 지정하세요.');
      void qc.invalidateQueries({ queryKey: ['settings', 'roles'] });
      onOpenChange(false);
      setForm({ key: '', name: '', description: '', rank: '30' });
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>사용자 정의 역할</DialogTitle>
          <DialogDescription>서열은 자신의 역할({myRank})보다 낮아야 합니다. 기본 서열: 경영진 80 · 매니저 60 · 직원 40 · 게스트 10</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="키" htmlFor="role-key" hint="영문 대문자·숫자·_ (예: INTERN)"><Input id="role-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></Field>
            <Field label="이름" htmlFor="role-name"><Input id="role-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          </div>
          <Field label="서열" htmlFor="role-rank"><Input id="role-rank" type="number" min={1} max={Math.min(99, myRank - 1)} value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} /></Field>
          <Field label="설명 (선택)" htmlFor="role-desc"><Input id="role-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={create.isPending}>만들기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
