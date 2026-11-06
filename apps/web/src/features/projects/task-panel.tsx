'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from '@oogam/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Link2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Avatar, Checkbox } from '@/components/ui/misc';
import { api, apiDelete, apiGet, apiPatch, apiPost, csrfToken } from '@/lib/api';
import { useDirectory } from '@/lib/directory';
import { cn, formatDateTime, timeAgo, toDateInput } from '@/lib/utils';
import type { ChecklistItem, CustomStatus, Milestone, Task, TaskDetail } from './types';
import { PriorityIcon, TaskStatusBadge } from './ui';

export function useTaskMutations(projectId?: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task'] });
    if (projectId) qc.invalidateQueries({ queryKey: ['projects', projectId] });
  };
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => apiPatch<Task>(`/tasks/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<Task>('/tasks', body),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/tasks/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });
  return { update, create, remove, invalidate };
}

export function TaskPanel({ taskId, onClose, statuses = [], milestones = [], onOpenTask }: {
  taskId: string | null;
  onClose: () => void;
  statuses?: CustomStatus[];
  milestones?: Milestone[];
  onOpenTask?: (id: string) => void;
}) {
  return (
    <DialogPrimitive.Root open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-background shadow-2xl focus:outline-none" aria-describedby={undefined}>
          {taskId && <TaskPanelBody taskId={taskId} onClose={onClose} statuses={statuses} milestones={milestones} onOpenTask={onOpenTask} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TaskPanelBody({ taskId, onClose, statuses, milestones, onOpenTask }: { taskId: string; onClose: () => void; statuses: CustomStatus[]; milestones: Milestone[]; onOpenTask?: (id: string) => void }) {
  const { data: task, error, isLoading } = useQuery({ queryKey: ['task', taskId], queryFn: () => apiGet<TaskDetail>(`/tasks/${taskId}`) });
  const { update, create, remove } = useTaskMutations(task?.projectId);
  const { data: users = [] } = useDirectory();
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? '알 수 없음';
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [newSub, setNewSub] = useState('');
  const [newCheck, setNewCheck] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDesc(task.description ?? '');
    }
  }, [task?.id, task?.title, task?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div className="p-6"><LoadingRows /></div>;
  if (error || !task) return <div className="p-6"><ErrorState error={error} /></div>;

  const patch = (body: Record<string, unknown>) => update.mutate({ id: task.id, ...body });
  const setChecklist = (items: ChecklistItem[]) => patch({ checklist: items });

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {task.project && <Link href={`/admin/projects/${task.project.id}`} className="hover:text-foreground">{task.project.key} · {task.project.name}</Link>}
          {task.parent && <><span>/</span><button className="hover:text-foreground" onClick={() => onOpenTask?.(task.parent!.id)}>{task.parent.title}</button></>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="업무 삭제" onClick={() => { if (confirm('이 업무와 하위 업무를 삭제할까요?')) remove.mutate(task.id, { onSuccess: onClose }); }}><Trash2 /></Button>
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" aria-label="닫기"><X /></Button></DialogPrimitive.Close>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <DialogPrimitive.Title asChild>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })} className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none" aria-label="업무 제목" />
        </DialogPrimitive.Title>

        <dl className="mt-5 grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">상태</dt>
          <dd>
            <NativeSelect className="h-8 w-auto" aria-label="상태" value={task.customStatus ? `c:${task.customStatus.id}` : task.status} onChange={(e) => {
              const v = e.target.value;
              patch(v.startsWith('c:') ? { customStatusId: v.slice(2) } : { status: v });
            }}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
              {statuses.length > 0 && <optgroup label="사용자 정의 상태">{statuses.map((s) => <option key={s.id} value={`c:${s.id}`}>{s.name} ({TASK_STATUS_LABELS[s.category]})</option>)}</optgroup>}
            </NativeSelect>
          </dd>
          <dt className="text-muted-foreground">우선순위</dt>
          <dd><NativeSelect className="h-8 w-auto" aria-label="우선순위" value={task.priority} onChange={(e) => patch({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</NativeSelect></dd>
          <dt className="text-muted-foreground">담당자</dt>
          <dd><UserPicker value={task.assignees.map((a) => a.id)} onChange={(ids) => patch({ assigneeIds: ids })} placeholder="담당자 지정" /></dd>
          <dt className="text-muted-foreground">시작일</dt>
          <dd><Input type="date" className="h-8 w-auto" aria-label="시작일" value={toDateInput(task.startDate)} onChange={(e) => patch({ startDate: e.target.value || null })} /></dd>
          <dt className="text-muted-foreground">마감일</dt>
          <dd><Input type="date" className="h-8 w-auto" aria-label="마감일" value={toDateInput(task.dueDate)} onChange={(e) => patch({ dueDate: e.target.value || null })} /></dd>
          {task.projectId && (
            <>
              <dt className="text-muted-foreground">마일스톤</dt>
              <dd>
                <NativeSelect className="h-8 w-auto" aria-label="마일스톤" value={task.milestoneId ?? ''} onChange={(e) => patch({ milestoneId: e.target.value || null })}>
                  <option value="">없음</option>
                  {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </NativeSelect>
              </dd>
            </>
          )}
        </dl>

        <Section title="설명">
          <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (task.description ?? '') && patch({ description: desc || null })} placeholder="업무 설명을 입력하세요." />
        </Section>

        <Section title={`체크리스트 ${task.checklist.length ? `(${task.checklist.filter((c) => c.done).length}/${task.checklist.length})` : ''}`}>
          <ul className="space-y-1.5">
            {task.checklist.map((c) => (
              <li key={c.id} className="group flex items-center gap-2 text-sm">
                <Checkbox checked={c.done} onCheckedChange={(v) => setChecklist(task.checklist.map((x) => (x.id === c.id ? { ...x, done: !!v } : x)))} aria-label={c.text} />
                <span className={cn('flex-1', c.done && 'text-muted-foreground line-through')}>{c.text}</span>
                <button className="opacity-0 group-hover:opacity-100" aria-label="항목 삭제" onClick={() => setChecklist(task.checklist.filter((x) => x.id !== c.id))}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newCheck.trim()) return; setChecklist([...task.checklist, { id: crypto.randomUUID().slice(0, 8), text: newCheck.trim(), done: false }]); setNewCheck(''); }}>
            <Input className="h-8" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} placeholder="항목 추가" aria-label="체크리스트 항목 추가" />
            <Button size="sm" variant="outline" type="submit">추가</Button>
          </form>
        </Section>

        <Section title={`하위 업무 (${task.subtasks.length})`}>
          <ul className="divide-y divide-border rounded-md border border-border">
            {task.subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Checkbox checked={s.status === 'DONE'} onCheckedChange={(v) => update.mutate({ id: s.id, status: v ? 'DONE' : 'TODO' })} aria-label={`${s.title} 완료`} />
                <button className={cn('flex-1 text-left hover:underline', s.status === 'DONE' && 'text-muted-foreground line-through')} onClick={() => onOpenTask?.(s.id)}>{s.title}</button>
                <PriorityIcon priority={s.priority} />
              </li>
            ))}
            {task.subtasks.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">하위 업무가 없습니다.</li>}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newSub.trim()) return; create.mutate({ title: newSub.trim(), parentId: task.id }, { onSuccess: () => setNewSub('') }); }}>
            <Input className="h-8" value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="하위 업무 추가" aria-label="하위 업무 추가" />
            <Button size="sm" variant="outline" type="submit" loading={create.isPending}><Plus />추가</Button>
          </form>
        </Section>

        {task.projectId && <Dependencies task={task} />}
        <RelatedDocs task={task} />
        <Attachments taskId={task.id} />
        <Comments taskId={task.id} />

        <Section title="변경 이력">
          <ol className="space-y-2 text-xs text-muted-foreground">
            {task.history.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums">{formatDateTime(h.createdAt)}</span>
                <span><b className="font-medium text-foreground">{userName(h.actorId)}</b> {h.action === 'task.created' ? '업무 생성' : h.action === 'task.deleted' ? '삭제' : Object.keys(h.changes ?? {}).map((k) => `${k}${fmtChange(h.changes![k])}`).join(', ')}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}

function fmtChange(c: { from: unknown; to: unknown }) {
  const s = (v: unknown) => (v === null || v === undefined ? '없음' : Array.isArray(v) ? `${v.length}명` : typeof v === 'string' ? v.slice(0, 30) : String(v));
  return `: ${s(c.from)} → ${s(c.to)}`;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Dependencies({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const candidates = useQuery({
    queryKey: ['tasks', 'candidates', task.projectId],
    queryFn: () => apiGet<{ items: Task[] }>('/tasks', { projectId: task.projectId!, pageSize: 100, parentId: 'root' }),
    enabled: adding,
  });
  const add = useMutation({
    mutationFn: (dependsOnId: string) => apiPost(`/tasks/${task.id}/dependencies`, { dependsOnId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task', task.id] }); setAdding(false); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({ mutationFn: (depId: string) => apiDelete(`/tasks/${task.id}/dependencies/${depId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['task', task.id] }) });
  return (
    <Section title="선행 업무" action={<Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}><Plus />연결</Button>}>
      {adding && (
        <NativeSelect className="mb-2" defaultValue="" onChange={(e) => e.target.value && add.mutate(e.target.value)} aria-label="선행 업무 선택">
          <option value="">선행 업무 선택…</option>
          {candidates.data?.items.filter((t) => t.id !== task.id && !task.dependencies.some((d) => d.task.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </NativeSelect>
      )}
      <ul className="space-y-1 text-sm">
        {task.dependencies.map((d) => (
          <li key={d.id} className="flex items-center gap-2"><TaskStatusBadge status={d.task.status} /><span className="flex-1">{d.task.title}</span><button aria-label="연결 해제" onClick={() => remove.mutate(d.id)}><X className="size-3.5" /></button></li>
        ))}
        {task.dependencies.length === 0 && !adding && <li className="text-xs text-muted-foreground">선행 업무 없음</li>}
      </ul>
    </Section>
  );
}

function RelatedDocs({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['documents', 'search', q],
    queryFn: () => apiGet<{ items: { id: string; title: string }[] }>('/documents', { q, pageSize: 8 }),
    enabled: q.length >= 2,
  });
  const link = useMutation({
    mutationFn: (pageId: string) => apiPost(`/tasks/${task.id}/links`, { targetType: 'PAGE', targetId: pageId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task', task.id] }); setQ(''); },
    onError: (e) => toast.error((e as Error).message),
  });
  const unlink = useMutation({ mutationFn: (linkId: string) => apiDelete(`/tasks/${task.id}/links/${linkId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['task', task.id] }) });
  return (
    <Section title="관련 문서">
      <ul className="space-y-1 text-sm">
        {task.documents.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <Link href={`/admin/docs/${d.id}`} className="flex-1 hover:underline">{d.icon} {d.title || '제목 없음'}</Link>
            {d.linkId && <button aria-label="연결 해제" onClick={() => unlink.mutate(d.linkId!)}><X className="size-3.5" /></button>}
          </li>
        ))}
      </ul>
      <div className="relative mt-2">
        <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-8 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 검색하여 연결 (2자 이상)" aria-label="관련 문서 검색" />
        {q.length >= 2 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background p-1 shadow-lg">
            {search.error && <p className="px-2 py-1.5 text-xs text-muted-foreground">문서 검색을 사용할 수 없습니다.</p>}
            {search.data?.items.map((d) => <button key={d.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => link.mutate(d.id)}>{d.title || '제목 없음'}</button>)}
            {search.data?.items.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">결과 없음</p>}
          </div>
        )}
      </div>
    </Section>
  );
}

interface FileItem { id: string; originalName: string; size: number; url: string; createdAt: string }

function Attachments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const files = useQuery({
    queryKey: ['files', 'TASK', taskId],
    queryFn: () => apiGet<{ items: FileItem[] } | FileItem[]>('/files', { targetType: 'TASK', targetId: taskId }),
  });
  const items = Array.isArray(files.data) ? files.data : files.data?.items ?? [];
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('targetType', 'TASK');
      fd.append('targetId', taskId);
      const res = await fetch('/api/v1/files', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrfToken() ?? '' }, credentials: 'same-origin' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? '업로드 실패');
      qc.invalidateQueries({ queryKey: ['files', 'TASK', taskId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="첨부파일" action={<Button size="sm" variant="ghost" loading={uploading} onClick={() => input.current?.click()}><Paperclip />업로드</Button>}>
      <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      {files.error ? <p className="text-xs text-muted-foreground">첨부파일 목록을 불러올 수 없습니다.</p> : (
        <ul className="space-y-1 text-sm">
          {items.map((f) => <li key={f.id}><a href={f.url} className="hover:underline">{f.originalName}</a> <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)}KB</span></li>)}
          {items.length === 0 && <li className="text-xs text-muted-foreground">첨부파일 없음</li>}
        </ul>
      )}
    </Section>
  );
}

interface CommentItem { id: string; body: string; authorId: string; author?: { name: string } | null; createdAt: string; replies?: CommentItem[] }

function Comments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { data: users = [] } = useDirectory();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const comments = useQuery({ queryKey: ['comments', 'TASK', taskId], queryFn: () => apiGet<CommentItem[] | { items: CommentItem[] }>('/comments', { targetType: 'TASK', targetId: taskId }) });
  const list = Array.isArray(comments.data) ? comments.data : comments.data?.items ?? [];
  const post = useMutation({
    mutationFn: () => api('/comments', { method: 'POST', json: { targetType: 'TASK', targetId: taskId, body, mentions } }),
    onSuccess: () => { setBody(''); setMentions([]); qc.invalidateQueries({ queryKey: ['comments', 'TASK', taskId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const name = (c: CommentItem) => c.author?.name ?? users.find((u) => u.id === c.authorId)?.name ?? '알 수 없음';
  return (
    <Section title="댓글">
      {comments.error ? <p className="text-xs text-muted-foreground">댓글을 불러올 수 없습니다.</p> : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={name(c)} className="size-6" />
              <div className="min-w-0 flex-1">
                <p className="text-xs"><b className="font-medium">{name(c)}</b> <span className="text-muted-foreground">{timeAgo(c.createdAt)}</span></p>
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
            </li>
          ))}
          {list.length === 0 && <li className="text-xs text-muted-foreground">아직 댓글이 없습니다.</li>}
        </ul>
      )}
      <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) post.mutate(); }}>
        <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="댓글 작성" aria-label="댓글 작성" />
        <div className="flex items-center gap-2">
          <div className="flex-1"><UserPicker value={mentions} onChange={setMentions} placeholder="@멘션할 사용자 (선택)" /></div>
          <Button size="sm" type="submit" loading={post.isPending}>등록</Button>
        </div>
      </form>
    </Section>
  );
}
