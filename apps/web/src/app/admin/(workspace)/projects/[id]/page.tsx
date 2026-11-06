'use client';
import { PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from '@oogam/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileText, GanttChart, KanbanSquare, List, Plus, Settings2, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { DevStatus, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { UserPicker } from '@/components/admin/user-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectFormDialog } from '@/features/projects/project-form';
import { TaskPanel, useTaskMutations } from '@/features/projects/task-panel';
import type { ProjectDetail, Task } from '@/features/projects/types';
import { ProgressBar, ProjectStatusBadge } from '@/features/projects/ui';
import { CalendarView, KanbanView, TaskListView, TimelineView } from '@/features/projects/views';
import { apiDelete, apiGet, apiPost, type Paginated } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/utils';
import { formatKRW } from '@oogam/shared';

function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(params.get('task'));
  const [editOpen, setEditOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<TaskStatus>('TODO');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const project = useQuery({ queryKey: ['projects', id], queryFn: () => apiGet<ProjectDetail>(`/projects/${id}`) });
  const tasks = useQuery({
    queryKey: ['tasks', { projectId: id, assigneeFilter }],
    queryFn: () => apiGet<Paginated<Task>>('/tasks', { projectId: id, parentId: 'root', pageSize: 100, assigneeId: assigneeFilter || undefined }),
    enabled: project.isSuccess,
  });
  const { update, create } = useTaskMutations(id);
  const reorder = useMutation({
    mutationFn: (items: { id: string; position: number; status?: TaskStatus }[]) => apiPost('/tasks/reorder', { items }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['projects', id] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (project.error) return <ErrorState error={project.error} />;
  if (!project.data) return <LoadingRows rows={8} />;
  const p = project.data;
  const canEdit = p.access !== 'view';
  const items = tasks.data?.items ?? [];

  const openTask = (tid: string) => setTaskId(tid);

  return (
    <>
      <PageHeader
        title={p.name}
        description={`${p.key} · ${p.department?.name ?? '부서 미지정'} · ${formatDate(p.startDate)} ~ ${formatDate(p.endDate)}`}
        actions={
          <>
            <ProjectStatusBadge status={p.status} />
            <Badge variant="outline">우선순위 {PRIORITY_LABELS[p.priority]}</Badge>
            {p.access === 'manage' && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Settings2 />설정</Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="진행률"><div className="flex items-center gap-2"><ProgressBar value={p.progress} /><span className="text-sm font-semibold tabular-nums">{p.progress}%</span></div></Stat>
        {TASK_STATUSES.slice(1).map((s) => <Stat key={s} label={TASK_STATUS_LABELS[s]}><span className="text-2xl font-semibold tabular-nums">{p.taskCounts[s] ?? 0}</span></Stat>)}
      </div>

      <Tabs defaultValue="list">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="list"><List />리스트</TabsTrigger>
            <TabsTrigger value="kanban"><KanbanSquare />칸반</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays />캘린더</TabsTrigger>
            <TabsTrigger value="timeline"><GanttChart />타임라인</TabsTrigger>
            <TabsTrigger value="overview">개요</TabsTrigger>
          </TabsList>
          <NativeSelect className="h-8 w-40" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="담당자 필터">
            <option value="">모든 담당자</option>
            {p.members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
          </NativeSelect>
        </div>

        {canEdit && (
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newTitle.trim()) return; create.mutate({ title: newTitle.trim(), projectId: id, status: newStatus }, { onSuccess: () => { setNewTitle(''); toast.success('업무를 추가했습니다.'); } }); }}>
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="새 업무 제목을 입력하고 Enter" aria-label="새 업무 제목" data-testid="new-task-title" />
            <NativeSelect className="w-32" value={newStatus} onChange={(e) => setNewStatus(e.target.value as TaskStatus)} aria-label="새 업무 상태">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</NativeSelect>
            <Button type="submit" loading={create.isPending}><Plus />추가</Button>
          </form>
        )}

        <TabsContent value="list">
          {tasks.isLoading ? <LoadingRows /> : items.length === 0 ? <EmptyState title="업무가 없습니다" description="위 입력란에서 첫 업무를 추가하세요." /> : <TaskListView tasks={items} onOpen={openTask} />}
        </TabsContent>
        <TabsContent value="kanban">
          <KanbanView tasks={items} onOpen={openTask} onMove={(tid, status, position) => (canEdit ? reorder.mutate([{ id: tid, status, position }]) : toast.error('편집 권한이 없습니다.'))} />
        </TabsContent>
        <TabsContent value="calendar"><CalendarView tasks={items} onOpen={openTask} /></TabsContent>
        <TabsContent value="timeline">
          <TimelineView tasks={items} onOpen={openTask} />
          <div className="mt-4"><DevStatus status="NOT_STARTED">Gantt 차트(의존 관계 화살표, 드래그로 일정 조정)는 후속 단계입니다. 현재 타임라인은 시작일~마감일 막대만 표시합니다.</DevStatus></div>
        </TabsContent>
        <TabsContent value="overview"><Overview project={p} onUpdated={() => qc.invalidateQueries({ queryKey: ['projects', id] })} /></TabsContent>
      </Tabs>

      <TaskPanel taskId={taskId} onClose={() => { setTaskId(null); router.replace(`/admin/projects/${id}`); }} statuses={p.statuses} milestones={p.milestones} onOpenTask={openTask} />
      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={p} />
      {update.isPending && <span className="sr-only" role="status">저장 중</span>}
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <Card className="p-4"><p className="mb-2 text-xs text-muted-foreground">{label}</p>{children}</Card>;
}

function Overview({ project: p, onUpdated }: { project: ProjectDetail; onUpdated: () => void }) {
  const router = useRouter();
  const [members, setMembers] = useState<string[]>([]);
  const [ms, setMs] = useState({ name: '', dueDate: '' });
  const [status, setStatus] = useState({ name: '', category: 'IN_PROGRESS' as TaskStatus });
  const manage = p.access === 'manage';
  const run = (fn: () => Promise<unknown>, msg?: string) => fn().then(() => { onUpdated(); if (msg) toast.success(msg); }).catch((e) => toast.error((e as Error).message));
  const activity = useQuery({ queryKey: ['projects', p.id, 'activity'], queryFn: () => apiGet<{ id: string; action: string; createdAt: string; actor: { name: string } | null; entityType: string }[]>(`/projects/${p.id}/activity`) });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader><CardTitle>설명</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.description || '설명이 없습니다.'}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>마일스톤</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {p.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={m.status === 'DONE'} disabled={p.access === 'view'} aria-label={`${m.name} 완료`} onChange={(e) => run(() => import('@/lib/api').then(({ apiPatch }) => apiPatch(`/projects/${p.id}/milestones/${m.id}`, { status: e.target.checked ? 'DONE' : 'OPEN' })))} />
                <span className="flex-1">{m.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatDate(m.dueDate)}</span>
                {p.access !== 'view' && <button aria-label="마일스톤 삭제" onClick={() => run(() => apiDelete(`/projects/${p.id}/milestones/${m.id}`))}><Trash2 className="size-3.5 text-muted-foreground" /></button>}
              </div>
            ))}
            {p.milestones.length === 0 && <p className="text-sm text-muted-foreground">마일스톤이 없습니다.</p>}
            {p.access !== 'view' && (
              <form className="flex gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (ms.name.trim()) run(() => apiPost(`/projects/${p.id}/milestones`, { name: ms.name.trim(), dueDate: ms.dueDate || undefined }).then(() => setMs({ name: '', dueDate: '' }))); }}>
                <Input className="h-8" placeholder="마일스톤 이름" value={ms.name} onChange={(e) => setMs({ ...ms, name: e.target.value })} aria-label="마일스톤 이름" />
                <Input className="h-8 w-40" type="date" value={ms.dueDate} onChange={(e) => setMs({ ...ms, dueDate: e.target.value })} aria-label="마일스톤 마감일" />
                <Button size="sm" variant="outline" type="submit">추가</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>사용자 정의 업무 상태</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">기본 상태(할 일 → 진행 중 → 검토 → 완료)에 매핑되는 프로젝트별 상태를 추가할 수 있습니다.</p>
            <div className="flex flex-wrap gap-2">
              {p.statuses.map((s) => (
                <Badge key={s.id} variant="outline" className="gap-1.5">{s.name} <span className="text-muted-foreground">→ {TASK_STATUS_LABELS[s.category]}</span>{manage && <button aria-label="상태 삭제" onClick={() => run(() => apiDelete(`/projects/${p.id}/statuses/${s.id}`))}><X className="size-3" /></button>}</Badge>
              ))}
            </div>
            {manage && (
              <form className="flex gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (status.name.trim()) run(() => apiPost(`/projects/${p.id}/statuses`, { name: status.name.trim(), category: status.category }).then(() => setStatus({ ...status, name: '' }))); }}>
                <Input className="h-8" placeholder="상태 이름 (예: QA 대기)" value={status.name} onChange={(e) => setStatus({ ...status, name: e.target.value })} aria-label="상태 이름" />
                <NativeSelect className="h-8 w-32" value={status.category} onChange={(e) => setStatus({ ...status, category: e.target.value as TaskStatus })} aria-label="기본 상태 매핑">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</NativeSelect>
                <Button size="sm" variant="outline" type="submit">추가</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>활동 로그</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-1.5 text-xs text-muted-foreground">
              {activity.data?.slice(0, 30).map((a) => <li key={a.id}><span className="tabular-nums">{formatDateTime(a.createdAt)}</span> · <b className="font-medium text-foreground">{a.actor?.name ?? '시스템'}</b> · {ACTION_LABELS[a.action] ?? a.action}</li>)}
            </ol>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>멤버 ({p.members.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {p.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar name={m.user.name} className="size-6" />
                <span className="flex-1">{m.user.name}</span>
                <Badge variant="muted">{m.role === 'MANAGER' ? '관리자' : m.role === 'MEMBER' ? '멤버' : '열람'}</Badge>
                {manage && m.user.id !== p.manager?.id && <button aria-label={`${m.user.name} 제외`} onClick={() => run(() => apiDelete(`/projects/${p.id}/members/${m.user.id}`))}><X className="size-3.5 text-muted-foreground" /></button>}
              </div>
            ))}
            {manage && (
              <div className="flex gap-2 pt-2">
                <div className="flex-1"><UserPicker value={members} onChange={setMembers} placeholder="멤버 추가" exclude={p.members.map((m) => m.user.id)} /></div>
                <Button size="icon" variant="outline" aria-label="멤버 추가" disabled={!members.length} onClick={() => run(() => Promise.all(members.map((userId) => apiPost(`/projects/${p.id}/members`, { userId }))).then(() => setMembers([])), '멤버를 추가했습니다.')}><UserPlus /></Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>관련 문서</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {p.documents.map((d) => <Link key={d.id} href={`/admin/docs/${d.id}`} className="flex items-center gap-2 text-sm hover:underline"><FileText className="size-4 text-muted-foreground" />{d.title || '제목 없음'}</Link>)}
            {p.documents.length === 0 && <p className="text-sm text-muted-foreground">연결된 문서가 없습니다. 업무 상세에서 문서를 연결할 수 있습니다.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>예산</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {p.budget ? <Link href="/admin/finance/budgets" className="hover:underline">{p.budget.name} ({p.budget.fiscalYear}) · 승인 {formatKRW(p.budget.approvedAmount)}</Link> : <p className="text-muted-foreground">연결된 예산이 없거나 열람 권한이 없습니다.</p>}
          </CardContent>
        </Card>
        {manage && (
          <Button variant="outline" className="w-full text-danger" onClick={() => { if (confirm('프로젝트를 삭제할까요? (휴지통으로 이동, 관리자 복구 가능)')) apiDelete(`/projects/${p.id}`).then(() => { toast.success('삭제했습니다.'); router.push('/admin/projects'); }).catch((e) => toast.error((e as Error).message)); }}>
            <Trash2 />프로젝트 삭제
          </Button>
        )}
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'project.created': '프로젝트 생성', 'project.updated': '프로젝트 정보 변경', 'project.deleted': '프로젝트 삭제',
  'project.member.added': '멤버 추가', 'project.member.removed': '멤버 제외',
  'task.created': '업무 생성', 'task.updated': '업무 변경', 'task.deleted': '업무 삭제',
};

export default function Page() {
  return <Suspense><ProjectDetailPage /></Suspense>;
}
