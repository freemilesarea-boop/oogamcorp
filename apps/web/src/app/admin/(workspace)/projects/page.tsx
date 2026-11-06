'use client';
import { PRIORITY_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProjectFormDialog } from '@/features/projects/project-form';
import type { ProjectListItem } from '@/features/projects/types';
import { ProgressBar, ProjectStatusBadge } from '@/features/projects/ui';
import { apiGet, type Paginated } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

export default function ProjectsPage() {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, isLoading } = useQuery({
    queryKey: ['projects', { q, status, mine, page }],
    queryFn: () => apiGet<Paginated<ProjectListItem>>('/projects', { q, status, mine: mine ? 'true' : undefined, page, pageSize: 20 }),
  });

  return (
    <>
      <PageHeader
        title="프로젝트"
        description="부서·프로젝트 단위로 업무와 일정을 관리합니다."
        actions={can('projects.write') && <Button onClick={() => setOpen(true)} data-testid="new-project"><Plus />새 프로젝트</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="이름 또는 키 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="프로젝트 검색" />
        <NativeSelect className="w-36" value={status} onChange={(e) => { setStatus(e.target.value as ProjectStatus | ''); setPage(1); }} aria-label="상태 필터">
          <option value="">모든 상태</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 프로젝트만</label>
      </div>
      {error ? <ErrorState error={error} /> : isLoading ? <LoadingRows /> : data && data.items.length === 0 ? (
        <EmptyState icon={FolderKanban} title="프로젝트가 없습니다" description="새 프로젝트를 만들어 업무를 시작하세요." action={can('projects.write') && <Button onClick={() => setOpen(true)}><Plus />새 프로젝트</Button>} />
      ) : data && (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent"><TH>프로젝트</TH><TH>상태</TH><TH>우선순위</TH><TH>관리자</TH><TH>부서</TH><TH className="w-40">진행률</TH><TH>기간</TH></TR>
            </THead>
            <TBody>
              {data.items.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/admin/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <p className="text-xs text-muted-foreground">{p.key} · 업무 {p._count.tasks} · 멤버 {p._count.members}</p>
                  </TD>
                  <TD><ProjectStatusBadge status={p.status} /></TD>
                  <TD className="text-xs">{PRIORITY_LABELS[p.priority]}</TD>
                  <TD>{p.manager ? <span className="flex items-center gap-2 text-sm"><Avatar name={p.manager.name} className="size-6" />{p.manager.name}</span> : '-'}</TD>
                  <TD className="text-sm">{p.department?.name ?? '-'}</TD>
                  <TD><div className="flex items-center gap-2"><ProgressBar value={p.progress} label={`${p.name} 진행률`} /><span className="w-9 text-right text-xs tabular-nums">{p.progress}%</span></div></TD>
                  <TD className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatDate(p.startDate)} ~ {formatDate(p.endDate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
      <ProjectFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
