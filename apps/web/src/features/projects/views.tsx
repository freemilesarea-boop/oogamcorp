'use client';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from '@oogam/shared';
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AvatarStack } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn, formatDate } from '@/lib/utils';
import type { Task } from './types';
import { isOverdue, PriorityIcon, TaskStatusBadge } from './ui';

export function TaskListView({ tasks, onOpen, showProject }: { tasks: Task[]; onOpen: (id: string) => void; showProject?: boolean }) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>업무</TH>
          {showProject && <TH>프로젝트</TH>}
          <TH>상태</TH>
          <TH>우선순위</TH>
          <TH>담당자</TH>
          <TH>마감일</TH>
        </TR>
      </THead>
      <TBody>
        {tasks.map((t) => (
          <TR key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
            <TD className="max-w-md">
              <button className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>{t.title}</button>
              {(t.subtaskCount > 0 || t.checklist.length > 0) && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.subtaskCount > 0 && `하위 ${t.subtaskCount}`}{t.checklist.length > 0 && ` · ✓ ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}`}
                </span>
              )}
            </TD>
            {showProject && <TD className="text-xs text-muted-foreground">{t.project ? `${t.project.key} · ${t.project.name}` : '개인'}</TD>}
            <TD><TaskStatusBadge status={t.status} custom={t.customStatus} /></TD>
            <TD><PriorityIcon priority={t.priority} withLabel /></TD>
            <TD>{t.assignees.length ? <AvatarStack users={t.assignees} /> : <span className="text-xs text-muted-foreground">미지정</span>}</TD>
            <TD className={cn('text-xs tabular-nums', isOverdue(t.dueDate, t.status) && 'font-medium text-danger')}>{formatDate(t.dueDate)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function KanbanView({ tasks, onOpen, onMove }: { tasks: Task[]; onOpen: (id: string) => void; onMove: (id: string, status: TaskStatus, position: number) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = useMemo(() => {
    const map = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>;
    for (const t of tasks) map[t.status].push(t);
    for (const s of TASK_STATUSES) map[s].sort((a, b) => a.position - b.position);
    return map;
  }, [tasks]);

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over) return;
    const [kind, value] = over.split(':');
    let status: TaskStatus;
    let position: number;
    if (kind === 'col') {
      status = value as TaskStatus;
      const col = columns[status].filter((t) => t.id !== id);
      position = (col.at(-1)?.position ?? 0) + 1000;
    } else {
      const target = tasks.find((t) => t.id === value);
      if (!target || target.id === id) return;
      status = target.status;
      const col = columns[status].filter((t) => t.id !== id);
      const idx = col.findIndex((t) => t.id === target.id);
      const prev = col[idx - 1]?.position ?? target.position - 1000;
      position = (prev + target.position) / 2;
    }
    const task = tasks.find((t) => t.id === id);
    if (task && (task.status !== status || task.position !== position)) onMove(id, status, position);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((s) => <Column key={s} status={s} tasks={columns[s]} onOpen={onOpen} />)}
      </div>
    </DndContext>
  );
}

function Column({ status, tasks, onOpen }: { status: TaskStatus; tasks: Task[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section ref={setNodeRef} className={cn('flex min-h-48 flex-col rounded-lg bg-muted/60 p-2 transition-colors', isOver && 'bg-gray-200 dark:bg-gray-800')} aria-label={TASK_STATUS_LABELS[status]}>
      <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <span className="text-[13px] font-semibold">{TASK_STATUS_LABELS[status]}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => <Card key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function Card({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: `task:${task.id}` });
  return (
    <div ref={setDropRef}>
      <article
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}
        style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
        className={cn('cursor-grab rounded-md border border-border bg-background p-3 shadow-sm transition-shadow hover:shadow-md', isDragging && 'z-10 opacity-80 shadow-lg')}
        data-testid="kanban-card"
      >
        <p className="text-[13.5px] font-medium leading-snug">{task.title}</p>
        {task.customStatus && <p className="mt-1 text-[11px] text-muted-foreground">{task.customStatus.name}</p>}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PriorityIcon priority={task.priority} />
            {task.dueDate && <span className={cn('text-[11px] tabular-nums text-muted-foreground', isOverdue(task.dueDate, task.status) && 'text-danger')}>{formatDate(task.dueDate, { month: 'numeric', day: 'numeric' })}</span>}
          </div>
          {task.assignees.length > 0 && <AvatarStack users={task.assignees} max={3} />}
        </div>
      </article>
    </div>
  );
}

export function CalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const byDay = (d: Date) => tasks.filter((t) => t.dueDate && isSameDay(new Date(t.dueDate), d));
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달"><ChevronLeft /></Button>
        <h3 className="min-w-28 text-center font-semibold">{format(month, 'yyyy년 M월', { locale: ko })}</h3>
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달"><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>오늘</Button>
        <span className="ml-auto text-xs text-muted-foreground">마감일 기준</span>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border text-sm">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => <div key={d} className="border-b border-border bg-muted/60 px-2 py-1.5 text-xs font-medium text-muted-foreground">{d}</div>)}
        {days.map((d) => (
          <div key={d.toISOString()} className={cn('min-h-24 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0', !isSameMonth(d, month) && 'bg-muted/30 text-muted-foreground')}>
            <div className={cn('mb-1 text-xs tabular-nums', isSameDay(d, new Date()) && 'inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background')}>{d.getDate()}</div>
            <div className="space-y-1">
              {byDay(d).map((t) => (
                <button key={t.id} onClick={() => onOpen(t.id)} className={cn('block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px]', t.status === 'DONE' ? 'bg-muted text-muted-foreground line-through' : 'bg-foreground text-background')}>{t.title}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  if (!dated.length) return <p className="py-10 text-center text-sm text-muted-foreground">시작일 또는 마감일이 지정된 업무가 없습니다.</p>;
  const starts = dated.map((t) => new Date(t.startDate ?? t.dueDate!));
  const ends = dated.map((t) => new Date(t.dueDate ?? t.startDate!));
  const min = startOfWeek(new Date(Math.min(...starts.map(Number))), { weekStartsOn: 1 });
  const max = endOfWeek(new Date(Math.max(...ends.map(Number))), { weekStartsOn: 1 });
  const total = differenceInCalendarDays(max, min) + 1;
  const weeks: Date[] = [];
  for (let d = min; d <= max; d = addDays(d, 7)) weeks.push(d);
  const todayOffset = differenceInCalendarDays(new Date(), min);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div style={{ minWidth: Math.max(720, weeks.length * 90) }}>
        <div className="flex border-b border-border bg-muted/60 text-[11px] text-muted-foreground">
          <div className="w-56 shrink-0 px-3 py-1.5">업무</div>
          <div className="relative flex flex-1">{weeks.map((w) => <div key={w.toISOString()} className="flex-1 border-l border-border px-1.5 py-1.5">{format(w, 'M/d')}</div>)}</div>
        </div>
        {dated.map((t) => {
          const s = new Date(t.startDate ?? t.dueDate!);
          const e = new Date(t.dueDate ?? t.startDate!);
          const left = (differenceInCalendarDays(s, min) / total) * 100;
          const width = (Math.max(1, differenceInCalendarDays(e, s) + 1) / total) * 100;
          return (
            <div key={t.id} className="flex border-b border-border last:border-0">
              <button onClick={() => onOpen(t.id)} className="w-56 shrink-0 truncate px-3 py-2 text-left text-[13px] hover:underline">{t.title}</button>
              <div className="relative flex-1">
                {todayOffset >= 0 && todayOffset <= total && <div className="absolute inset-y-0 w-px bg-accent" style={{ left: `${(todayOffset / total) * 100}%` }} aria-hidden />}
                <button onClick={() => onOpen(t.id)} title={`${formatDate(s)} ~ ${formatDate(e)}`} className={cn('absolute top-1/2 h-5 -translate-y-1/2 rounded-sm', t.status === 'DONE' ? 'bg-gray-300 dark:bg-gray-700' : 'bg-foreground')} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
