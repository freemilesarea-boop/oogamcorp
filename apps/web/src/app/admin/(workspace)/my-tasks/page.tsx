'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TaskPanel, useTaskMutations } from '@/features/projects/task-panel';
import type { Task } from '@/features/projects/types';
import { TaskListView } from '@/features/projects/views';
import { apiGet } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { toast } from 'sonner';

type Groups = Record<'overdue' | 'today' | 'week' | 'later' | 'noDue' | 'done', Task[]>;
const GROUPS: { key: keyof Groups; label: string }[] = [
  { key: 'overdue', label: '기한 초과' },
  { key: 'today', label: '오늘 마감' },
  { key: 'week', label: '7일 이내' },
  { key: 'later', label: '이후' },
  { key: 'noDue', label: '마감일 없음' },
  { key: 'done', label: '완료' },
];

function MyTasks() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [taskId, setTaskId] = useState<string | null>(params.get('task'));
  const [includeDone, setIncludeDone] = useState(false);
  const [title, setTitle] = useState('');
  const { create } = useTaskMutations();
  const { data, error, isLoading } = useQuery({
    queryKey: ['tasks', 'mine', includeDone],
    queryFn: () => apiGet<{ total: number; groups: Groups }>('/tasks/mine', { includeDone: includeDone ? 'true' : 'false' }),
  });

  return (
    <>
      <PageHeader title="내 업무" description="나에게 배정된 업무를 마감일 기준으로 모아봅니다." actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> 완료 포함</label>} />
      <form className="mb-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; create.mutate({ title: title.trim(), assigneeIds: [me.user.id] }, { onSuccess: () => { setTitle(''); toast.success('개인 업무를 추가했습니다.'); } }); }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="개인 업무 빠르게 추가 (프로젝트 없음)" aria-label="개인 업무 추가" />
        <Button type="submit" loading={create.isPending}>추가</Button>
      </form>
      {error ? <ErrorState error={error} /> : isLoading || !data ? <LoadingRows /> : data.total === 0 ? (
        <EmptyState icon={CheckSquare} title="배정된 업무가 없습니다" description="프로젝트에서 업무를 배정받거나 개인 업무를 추가하세요." />
      ) : (
        <div className="space-y-8">
          {GROUPS.filter((g) => data.groups[g.key].length > 0).map((g) => (
            <section key={g.key}>
              <h2 className={`mb-2 text-sm font-semibold ${g.key === 'overdue' ? 'text-danger' : ''}`}>{g.label} <span className="font-normal text-muted-foreground">{data.groups[g.key].length}</span></h2>
              <TaskListView tasks={data.groups[g.key]} onOpen={setTaskId} showProject />
            </section>
          ))}
        </div>
      )}
      <TaskPanel taskId={taskId} onClose={() => { setTaskId(null); router.replace('/admin/my-tasks'); }} onOpenTask={setTaskId} />
    </>
  );
}

export default function Page() {
  return <Suspense><MyTasks /></Suspense>;
}
