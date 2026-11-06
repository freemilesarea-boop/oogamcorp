'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker } from '@/components/admin/user-picker';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';
import { DepartmentDialog } from '@/features/teams/department-dialog';
import { buildTree, type Department, type DepartmentMember, type TreeNode } from '@/features/teams/types';

export default function TeamsPage() {
  const can = useCan();
  const canManage = can('teams.manage');
  const list = useQuery({ queryKey: ['departments'], queryFn: () => apiGet<Department[]>('/departments') });
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ editing: Department | null; parentId?: string | null } | null>(null);
  const tree = useMemo(() => buildTree(list.data ?? []), [list.data]);
  const current = list.data?.find((d) => d.id === (selected ?? tree[0]?.id)) ?? null;

  return (
    <>
      <PageHeader
        title="부서"
        description="조직 구조와 부서별 구성원을 확인합니다."
        actions={canManage ? <Button size="sm" onClick={() => setDialog({ editing: null })}><Plus />부서 추가</Button> : undefined}
      />
      {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? (
        <EmptyState icon={Building2} title="등록된 부서가 없습니다" description={canManage ? '‘부서 추가’로 조직 구조를 만들어 보세요.' : undefined} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <Card className="h-fit p-2">
            <nav aria-label="부서 트리">
              <ul role="tree">
                {tree.map((n) => <TreeItem key={n.id} node={n} selected={current?.id ?? null} onSelect={setSelected} />)}
              </ul>
            </nav>
          </Card>
          {current && (
            <DepartmentDetail
              key={current.id}
              dept={current}
              all={list.data}
              canManage={canManage}
              onEdit={() => setDialog({ editing: current })}
              onAddChild={() => setDialog({ editing: null, parentId: current.id })}
              onDeleted={() => setSelected(null)}
              onSelect={setSelected}
            />
          )}
        </div>
      )}
      <DepartmentDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        departments={list.data ?? []}
        editing={dialog?.editing ?? null}
        defaultParentId={dialog?.parentId}
        onSaved={(d) => setSelected(d.id)}
      />
    </>
  );
}

function TreeItem({ node, selected, onSelect }: { node: TreeNode; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const active = node.id === selected;
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={active}>
      <div className={cn('flex items-center rounded-md text-sm', active ? 'bg-muted font-medium' : 'hover:bg-muted/60')} style={{ paddingLeft: node.depth * 14 }}>
        {node.children.length ? (
          <button type="button" className="p-1 text-muted-foreground" onClick={() => setOpen(!open)} aria-label={open ? '접기' : '펼치기'}>
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="w-[22px]" />}
        <button type="button" onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-2 text-left">
          <span className="truncate">{node.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{node.memberCount}</span>
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul role="group">{node.children.map((c) => <TreeItem key={c.id} node={c} selected={selected} onSelect={onSelect} />)}</ul>
      )}
    </li>
  );
}

function DepartmentDetail({ dept, all, canManage, onEdit, onAddChild, onDeleted, onSelect }: {
  dept: Department;
  all: Department[];
  canManage: boolean;
  onEdit: () => void;
  onAddChild: () => void;
  onDeleted: () => void;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['departments', dept.id, 'members'], queryFn: () => apiGet<DepartmentMember[]>(`/departments/${dept.id}/members`) });
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [removing, setRemoving] = useState<DepartmentMember | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['departments'] });
    void qc.invalidateQueries({ queryKey: ['directory'] });
    void qc.invalidateQueries({ queryKey: ['employees'] });
  };
  const onErr = (e: unknown) => toast.error((e as Error).message);
  const assign = useMutation({
    mutationFn: () => apiPost(`/departments/${dept.id}/members`, { userIds: assignIds }),
    onSuccess: () => { toast.success('구성원을 배치했습니다.'); setAssignOpen(false); setAssignIds([]); refresh(); },
    onError: onErr,
  });
  const removeMember = useMutation({ mutationFn: (userId: string) => apiDelete(`/departments/${dept.id}/members/${userId}`), onSuccess: refresh, onError: onErr });
  const del = useMutation({
    mutationFn: () => apiDelete(`/departments/${dept.id}${moveTo ? `?moveTo=${moveTo}` : ''}`),
    onSuccess: () => { toast.success('부서를 삭제했습니다.'); onDeleted(); refresh(); },
    onError: onErr,
  });
  const parent = all.find((d) => d.id === dept.parentId);
  const children = all.filter((d) => d.parentId === dept.id);
  const count = members.data?.length ?? dept.memberCount;

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {parent && <button type="button" onClick={() => onSelect(parent.id)} className="text-xs text-muted-foreground hover:underline">{parent.name} /</button>}
          <h2 className="text-xl font-semibold tracking-tight">{dept.name} {dept.code && <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{dept.code}</span>}</h2>
          {dept.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{dept.description}</p>}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}><UserPlus />구성원 배치</Button>
            <Button variant="outline" size="sm" onClick={onAddChild}><Plus />하위 부서</Button>
            <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="부서 수정"><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteOpen(true)} aria-label="부서 삭제"><Trash2 /></Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">부서장</p><p className="mt-1 truncate font-medium">{dept.manager?.name ?? '미지정'}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">구성원</p><p className="mt-1 text-xl font-semibold tabular-nums">{count}</p></Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">하위 부서</p>
          <p className="mt-1 truncate text-sm">{children.length ? children.map((c) => c.name).join(', ') : '없음'}</p>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">구성원</h3>
        {members.isLoading ? <LoadingRows rows={3} /> : members.error ? <ErrorState error={members.error} /> : !members.data?.length ? (
          <EmptyState title="이 부서에 배치된 구성원이 없습니다" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={m.name} src={m.avatarUrl} />
                <Link href={`/admin/employees?id=${m.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-sm font-medium">{m.name}{dept.managerId === m.id && <Badge variant="default" className="ml-2">부서장</Badge>}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.title ?? m.email}</span>
                </Link>
                <Badge variant="outline" className="hidden sm:inline-flex">{m.role.name}</Badge>
                {m.employmentStatus === 'ON_LEAVE' && <Badge variant="warning">휴직</Badge>}
                {canManage && <Button variant="ghost" size="icon-sm" aria-label={`${m.name} 부서에서 제외`} onClick={() => setRemoving(m)}><UserMinus /></Button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dept.name}에 구성원 배치</DialogTitle>
            <DialogDescription>선택한 구성원의 소속 부서가 이 부서로 변경됩니다.</DialogDescription>
          </DialogHeader>
          <UserPicker value={assignIds} onChange={setAssignIds} exclude={members.data?.map((m) => m.id) ?? []} placeholder="구성원 선택" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>취소</Button>
            <Button disabled={!assignIds.length} loading={assign.isPending} onClick={() => assign.mutate()}>배치</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`‘${dept.name}’ 부서를 삭제할까요?`}
        description={count > 0 ? `재직 중인 구성원 ${count}명이 있습니다. 옮길 부서를 선택해야 삭제할 수 있습니다.` : '하위 부서는 상위 부서로 이동합니다.'}
        confirmLabel="삭제"
        onConfirm={() => del.mutateAsync()}
      >
        {count > 0 && (
          <Field label="구성원을 옮길 부서" htmlFor="move-to">
            <NativeSelect id="move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">선택하세요</option>
              {all.filter((d) => d.id !== dept.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="부서에서 제외할까요?"
        description={removing ? `${removing.name} 님의 소속 부서가 ‘미지정’으로 변경됩니다.` : undefined}
        confirmLabel="제외"
        onConfirm={async () => { if (removing) await removeMember.mutateAsync(removing.id); }}
      />
    </section>
  );
}
