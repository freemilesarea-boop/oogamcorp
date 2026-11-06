'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ScrollText, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { UserPicker } from '@/components/admin/user-picker';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiGet, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

interface AuditLog {
  id: string;
  action: string;
  actorId: string | null;
  actor: { id: string; name: string; email: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const PREFIXES: { value: string; label: string }[] = [
  { value: 'auth.', label: '인증 (로그인·세션)' },
  { value: 'employee.', label: '직원·초대' },
  { value: 'hr.record', label: '민감 인사정보' },
  { value: 'permissions.', label: '역할·권한' },
  { value: 'settings.', label: '시스템 설정' },
  { value: 'department.', label: '부서' },
  { value: 'file.', label: '파일' },
  { value: 'announcement.', label: '공지' },
];

const ENTITY_TYPES = ['user', 'invitation', 'role', 'department', 'file', 'session', 'system_setting', 'announcement', 'project'];

function tone(action: string): 'danger' | 'warning' | 'info' | 'muted' {
  if (/failed|locked|deactivated|deleted|revoked/.test(action)) return 'danger';
  if (action.startsWith('hr.') || action.startsWith('permissions.') || action.includes('role')) return 'warning';
  if (action.startsWith('auth.')) return 'info';
  return 'muted';
}

export default function AuditLogsPage() {
  const can = useCan();
  const [f, setF] = useState({ action: '', actorId: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1); };
  const list = useQuery({
    queryKey: ['audit-logs', f, page],
    queryFn: () => apiGet<Paginated<AuditLog>>('/audit-logs', {
      page, pageSize: 50, action: f.action || undefined, actorId: f.actorId || undefined, entityType: f.entityType || undefined, from: f.from || undefined, to: f.to || undefined,
    }),
    enabled: can('audit.read'),
    placeholderData: (prev) => prev,
  });
  const filtered = Object.values(f).some(Boolean);

  if (!can('audit.read')) {
    return (
      <>
        <PageHeader title="감사 로그" />
        <EmptyState icon={ScrollText} title="감사 로그 열람 권한이 없습니다" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="감사 로그" description="로그인, 권한 변경, 민감 정보 열람 등 보안 관련 이벤트 기록입니다. 기록은 수정·삭제할 수 없습니다." />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        <NativeSelect value={f.action} onChange={(e) => set({ action: e.target.value })} className="lg:w-48" aria-label="이벤트 분류">
          <option value="">모든 이벤트</option>
          {PREFIXES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </NativeSelect>
        <NativeSelect value={f.entityType} onChange={(e) => set({ entityType: e.target.value })} className="lg:w-40" aria-label="대상 유형">
          <option value="">모든 대상</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </NativeSelect>
        <div className="lg:w-56"><UserPicker multiple={false} value={f.actorId ? [f.actorId] : []} onChange={(ids) => set({ actorId: ids[0] ?? '' })} placeholder="수행자 (전체)" /></div>
        <div className="flex items-center gap-1.5">
          <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="시작일" className="w-36" />
          <span className="text-muted-foreground">~</span>
          <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="종료일" className="w-36" />
        </div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setF({ action: '', actorId: '', entityType: '', from: '', to: '' }); setPage(1); }}><X />초기화</Button>}
      </div>
      {list.isLoading ? <LoadingRows rows={10} /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? (
        <EmptyState icon={ScrollText} title="조건에 맞는 기록이 없습니다" />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH className="w-44">일시</TH>
                <TH>이벤트</TH>
                <TH>수행자</TH>
                <TH className="hidden md:table-cell">대상</TH>
                <TH className="hidden lg:table-cell">IP</TH>
                <TH className="w-10"><span className="sr-only">상세</span></TH>
              </TR>
            </THead>
            <TBody>
              {list.data.items.map((l) => (
                <Fragment key={l.id}>
                  <TR>
                    <TD className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(l.createdAt)}</TD>
                    <TD><Badge variant={tone(l.action)} className="font-mono">{l.action}</Badge></TD>
                    <TD>{l.actor ? <span title={l.actor.email}>{l.actor.name}</span> : <span className="text-muted-foreground">시스템/미상</span>}</TD>
                    <TD className="hidden md:table-cell">
                      {l.entityType ? <span className="font-mono text-xs"><span className="text-muted-foreground">{l.entityType}</span> {l.entityId?.slice(0, 8)}</span> : '-'}
                    </TD>
                    <TD className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{l.ip ?? '-'}</TD>
                    <TD>
                      {(l.metadata || l.userAgent) && (
                        <Button variant="ghost" size="icon-sm" aria-expanded={open === l.id} aria-label="상세 보기" onClick={() => setOpen(open === l.id ? null : l.id)}>
                          <ChevronDown className={cn('transition-transform', open === l.id && 'rotate-180')} />
                        </Button>
                      )}
                    </TD>
                  </TR>
                  {open === l.id && (
                    <tr className="border-b border-border bg-muted/30">
                      <td colSpan={6} className="px-3 py-3">
                        {l.userAgent && <p className="mb-2 text-xs text-muted-foreground">User-Agent: {l.userAgent}</p>}
                        {l.entityId && <p className="mb-2 font-mono text-xs text-muted-foreground">entityId: {l.entityId}</p>}
                        {l.metadata && <pre className="overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">{JSON.stringify(l.metadata, null, 2)}</pre>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">총 {list.data.total.toLocaleString('ko-KR')}건</span>
            <Pagination page={page} totalPages={list.data.totalPages} onChange={setPage} />
          </div>
        </>
      )}
    </>
  );
}
