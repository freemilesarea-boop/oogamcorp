'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, Users, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiDelete, apiGet, apiPost, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useDepartments } from '@/lib/directory';
import { formatDate, formatDateTime, timeAgo } from '@/lib/utils';
import { ConfirmDialog } from '@/features/employees/confirm-dialog';
import { EmployeeSheet } from '@/features/employees/employee-sheet';
import { InviteDialog } from '@/features/employees/invite-dialog';
import { InviteLinkBox } from '@/features/employees/invite-link';
import { ACCOUNT_LABELS, EMPLOYMENT_LABELS, type Employee, type Invitation, type InviteResult, type RoleLite } from '@/features/employees/types';

export default function EmployeesPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <EmployeesInner />
    </Suspense>
  );
}

function EmployeesInner() {
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('id');
  const roles = useQuery({ queryKey: ['employees', 'roles'], queryFn: () => apiGet<RoleLite[]>('/employees/roles'), staleTime: 5 * 60_000 });
  const setSelected = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set('id', id);
    else sp.delete('id');
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="직원"
        description="조직 구성원과 역할, 부서, 계정 상태를 관리합니다."
        actions={can('employees.manage') && roles.data ? <InviteDialog roles={roles.data} /> : undefined}
      />
      {can('employees.manage') ? (
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">구성원</TabsTrigger>
            <TabsTrigger value="invites">초대</TabsTrigger>
          </TabsList>
          <TabsContent value="members"><EmployeeTable roles={roles.data ?? []} onOpen={setSelected} /></TabsContent>
          <TabsContent value="invites"><InvitationList /></TabsContent>
        </Tabs>
      ) : (
        <EmployeeTable roles={roles.data ?? []} onOpen={setSelected} />
      )}
      <EmployeeSheet userId={selected} roles={roles.data ?? []} onClose={() => setSelected(null)} />
    </>
  );
}

function EmployeeTable({ roles, onOpen }: { roles: RoleLite[]; onOpen: (id: string) => void }) {
  const { data: departments = [] } = useDepartments();
  const [f, setF] = useState({ q: '', departmentId: '', role: '', status: '', accountStatus: '' });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('name');
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1); };
  const list = useQuery({
    queryKey: ['employees', 'list', f, page, sort],
    queryFn: () => apiGet<Paginated<Employee>>('/employees', {
      page, pageSize: 25, q: f.q || undefined, departmentId: f.departmentId || undefined, role: f.role || undefined,
      status: f.status || undefined, accountStatus: f.accountStatus || undefined,
      sort: sort === 'name' ? undefined : sort, order: sort === 'name' ? undefined : 'desc',
    }),
    placeholderData: (prev) => prev,
  });
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <div className="relative lg:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="이름·이메일 검색" className="pl-8" aria-label="이름 또는 이메일 검색" />
        </div>
        <NativeSelect value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })} className="lg:w-40" aria-label="부서">
          <option value="">모든 부서</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect value={f.role} onChange={(e) => set({ role: e.target.value })} className="lg:w-36" aria-label="역할">
          <option value="">모든 역할</option>
          {roles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
        </NativeSelect>
        <NativeSelect value={f.status} onChange={(e) => set({ status: e.target.value })} className="lg:w-32" aria-label="재직 상태">
          <option value="">재직 상태</option>
          {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect value={f.accountStatus} onChange={(e) => set({ accountStatus: e.target.value })} className="lg:w-32" aria-label="계정 상태">
          <option value="">계정 상태</option>
          {Object.entries(ACCOUNT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="lg:w-36" aria-label="정렬">
          <option value="name">이름순</option>
          <option value="hireDate">입사일 최신순</option>
          <option value="lastLoginAt">최근 로그인순</option>
          <option value="createdAt">등록 최신순</option>
        </NativeSelect>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setF({ q: '', departmentId: '', role: '', status: '', accountStatus: '' }); setPage(1); }}><X />초기화</Button>}
      </div>
      {list.isLoading ? <LoadingRows rows={8} /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
        <EmptyState icon={Users} title={filtered ? '조건에 맞는 직원이 없습니다' : '등록된 직원이 없습니다'} description={filtered ? '필터를 조정해 보세요.' : '직원 초대로 구성원을 추가하세요.'} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>이름</TH>
                <TH className="hidden md:table-cell">부서 · 직책</TH>
                <TH>역할</TH>
                <TH className="hidden sm:table-cell">상태</TH>
                <TH className="hidden lg:table-cell">입사일</TH>
                <TH className="hidden lg:table-cell">최근 로그인</TH>
              </TR>
            </THead>
            <TBody>
              {list.data.items.map((e) => (
                <TR key={e.id} className="cursor-pointer" onClick={() => onOpen(e.id)}>
                  <TD>
                    <button type="button" className="flex min-w-0 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:underline" onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}>
                      <Avatar name={e.name} src={e.avatarUrl} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{e.email}</span>
                      </span>
                    </button>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <span className="block">{e.department?.name ?? '-'}</span>
                    {e.title && <span className="block text-xs text-muted-foreground">{e.title}</span>}
                  </TD>
                  <TD><Badge variant={e.role.key === 'OWNER' ? 'default' : 'outline'}>{e.role.name}</Badge></TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {e.accountStatus !== 'ACTIVE' && <Badge variant={e.accountStatus === 'DISABLED' ? 'danger' : 'muted'}>{ACCOUNT_LABELS[e.accountStatus]}</Badge>}
                      <Badge variant={e.employmentStatus === 'ACTIVE' ? 'success' : e.employmentStatus === 'ON_LEAVE' ? 'warning' : 'muted'}>{EMPLOYMENT_LABELS[e.employmentStatus]}</Badge>
                    </div>
                  </TD>
                  <TD className="hidden tabular-nums text-muted-foreground lg:table-cell">{formatDate(e.hireDate)}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell" title={e.lastLoginAt ? formatDateTime(e.lastLoginAt) : undefined}>{e.lastLoginAt ? timeAgo(e.lastLoginAt) : '-'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={list.data.totalPages} onChange={setPage} />
        </>
      )}
    </>
  );
}

const INVITE_STATUS: Record<Invitation['status'], { label: string; variant: 'info' | 'success' | 'muted' | 'danger' }> = {
  PENDING: { label: '대기', variant: 'info' },
  ACCEPTED: { label: '수락', variant: 'success' },
  REVOKED: { label: '취소', variant: 'muted' },
  EXPIRED: { label: '만료', variant: 'danger' },
};

function InvitationList() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [revoke, setRevoke] = useState<Invitation | null>(null);
  const [resent, setResent] = useState<InviteResult | null>(null);
  const list = useQuery({ queryKey: ['invitations', all], queryFn: () => apiGet<Invitation[]>('/employees/invitations', { status: all ? 'all' : 'pending' }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['invitations'] });
  const resend = useMutation({
    mutationFn: (id: string) => apiPost<InviteResult>(`/employees/invitations/${id}/resend`),
    onSuccess: (r) => { setResent(r); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/employees/invitations/${id}`),
    onSuccess: () => { toast.success('초대를 취소했습니다.'); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">초대 링크는 7일간 유효하며 1회만 사용할 수 있습니다.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 accent-foreground" />
          지난 초대 포함
        </label>
      </div>
      {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? (
        <EmptyState title="대기 중인 초대가 없습니다" description="‘직원 초대’로 새 구성원을 초대하세요." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>이메일</TH>
              <TH className="hidden md:table-cell">역할 · 부서</TH>
              <TH>상태</TH>
              <TH className="hidden sm:table-cell">만료</TH>
              <TH className="w-40"><span className="sr-only">작업</span></TH>
            </TR>
          </THead>
          <TBody>
            {list.data.map((i) => (
              <TR key={i.id}>
                <TD>
                  <span className="block font-medium">{i.email}</span>
                  <span className="block text-xs text-muted-foreground">{i.name ?? ''}{i.invitedBy ? ` · 초대: ${i.invitedBy.name}` : ''}</span>
                </TD>
                <TD className="hidden md:table-cell">{i.role.name}{i.department ? ` · ${i.department.name}` : ''}</TD>
                <TD><Badge variant={INVITE_STATUS[i.status].variant}>{INVITE_STATUS[i.status].label}</Badge></TD>
                <TD className="hidden tabular-nums text-muted-foreground sm:table-cell">{formatDateTime(i.expiresAt)}</TD>
                <TD>
                  {i.status !== 'ACCEPTED' && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => resend.mutate(i.id)} loading={resend.isPending && resend.variables === i.id}><RefreshCw />재발송</Button>
                      {i.status === 'PENDING' && <Button variant="ghost" size="sm" onClick={() => setRevoke(i)}>취소</Button>}
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="초대를 취소할까요?"
        description={revoke ? `${revoke.email} 으로 보낸 초대 링크가 즉시 무효화됩니다.` : undefined}
        confirmLabel="초대 취소"
        onConfirm={async () => { if (revoke) await del.mutateAsync(revoke.id); }}
      />
      <Dialog open={!!resent} onOpenChange={(o) => !o && setResent(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>새 초대 링크</DialogTitle></DialogHeader>
          {resent && <InviteLinkBox result={resent} />}
          <DialogFooter><Button onClick={() => setResent(null)}>완료</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
