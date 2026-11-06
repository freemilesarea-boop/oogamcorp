'use client';
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CheckSquare, ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DevStatus, ErrorState, PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/misc';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { RESPONSE_LABELS, useCalendarMutations, useEvents, useInvitations, type CalendarEvent, type TaskItem } from './api';
import { EventDialog } from './event-dialog';
import { dayKey, eventDays, rangeLabel, timeLabel } from './utils';

const HOUR_PX = 44;

function EventChip({ e, onOpen }: { e: CalendarEvent; onOpen: () => void }) {
  const declined = e.myResponse === 'DECLINED';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs',
        e.allDay ? 'bg-foreground text-background' : 'hover:bg-muted',
        e.myResponse === 'PENDING' && 'border border-dashed border-foreground/40 bg-transparent text-foreground',
        declined && 'line-through opacity-50',
      )}
      title={`${e.title} · ${rangeLabel(e)}`}
    >
      {!e.allDay && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />}
      {!e.allDay && <span className="tabular-nums text-muted-foreground">{timeLabel(e)}</span>}
      {e.isPrivate && <Lock className="size-3 shrink-0" aria-label="비공개" />}
      <span className="truncate">{e.title}</span>
    </button>
  );
}

function TaskChip({ t }: { t: TaskItem }) {
  return (
    <Link href={t.href} className={cn('flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted', t.status === 'DONE' && 'line-through')} title={`업무 마감: ${t.title}`}>
      <CheckSquare className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{t.project ? `${t.project.key} · ` : ''}{t.title}</span>
    </Link>
  );
}

function MonthGrid({ month, events, tasks, onOpen, onCreate }: { month: Date; events: CalendarEvent[]; tasks: TaskItem[]; onOpen: (id: string) => void; onCreate?: (d: Date) => void }) {
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = startOfWeek(startOfMonth(month)); d <= endOfWeek(endOfMonth(month)); d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) for (const k of eventDays(e)) map.set(k, [...(map.get(k) ?? []), e]);
    for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
    return map;
  }, [events]);
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const t of tasks) map.set(t.dueDate.slice(0, 10), [...(map.get(t.dueDate.slice(0, 10)) ?? []), t]);
    return map;
  }, [tasks]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs text-muted-foreground">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = dayKey(d);
          const evs = byDay.get(k) ?? [];
          const ts = tasksByDay.get(k) ?? [];
          const shown = evs.slice(0, 3);
          return (
            <div key={k} className={cn('group min-h-28 border-b border-r border-border p-1 [&:nth-child(7n)]:border-r-0', !isSameMonth(d, month) && 'bg-muted/30 text-muted-foreground')}>
              <div className="mb-0.5 flex items-center justify-between">
                <span className={cn('flex size-6 items-center justify-center rounded-full text-xs tabular-nums', isToday(d) && 'bg-foreground font-semibold text-background')}>{format(d, 'd')}</span>
                {onCreate && (
                  <button type="button" onClick={() => onCreate(d)} className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100" aria-label={`${format(d, 'M월 d일')} 일정 추가`}><Plus className="size-3.5" /></button>
                )}
              </div>
              <div className="space-y-0.5">
                {shown.map((e) => <EventChip key={e.id} e={e} onOpen={() => onOpen(e.id)} />)}
                {evs.length > shown.length && <p className="px-1.5 text-[11px] text-muted-foreground">+{evs.length - shown.length}개 더</p>}
                {ts.slice(0, 2).map((t) => <TaskChip key={t.id} t={t} />)}
                {ts.length > 2 && <p className="px-1.5 text-[11px] text-muted-foreground">업무 +{ts.length - 2}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 주간 보기: 종일 영역 + 시간 그리드 (겹치는 일정은 열로 나눠 배치) */
function WeekGrid({ weekStart, events, tasks, onOpen, onCreate }: { weekStart: Date; events: CalendarEvent[]; tasks: TaskItem[]; onOpen: (id: string) => void; onCreate?: (d: Date) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const layout = useMemo(() => {
    const perDay = new Map<string, { e: CalendarEvent; top: number; height: number; lane: number; lanes: number }[]>();
    for (const d of days) {
      const k = dayKey(d);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const items = events
        .filter((e) => !e.allDay && eventDays(e).includes(k))
        .map((e) => {
          const s = Math.max(new Date(e.startAt).getTime(), dayStart);
          const en = Math.min(new Date(e.endAt).getTime(), dayStart + 86_400_000);
          const top = ((s - dayStart) / 3_600_000) * HOUR_PX;
          return { e, top, height: Math.max(((en - s) / 3_600_000) * HOUR_PX, 18), lane: 0, lanes: 1 };
        })
        .sort((a, b) => a.top - b.top);
      const laneEnds: number[] = [];
      for (const it of items) {
        let lane = laneEnds.findIndex((end) => end <= it.top);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = it.top + it.height;
        it.lane = lane;
      }
      items.forEach((it) => (it.lanes = Math.max(1, laneEnds.length)));
      perDay.set(k, items);
    }
    return perDay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, weekStart]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/40 text-center text-xs">
        <div />
        {days.map((d) => (
          <div key={dayKey(d)} className="py-2">
            <span className="text-muted-foreground">{format(d, 'EEE', { locale: ko })}</span>{' '}
            <span className={cn('inline-flex size-6 items-center justify-center rounded-full tabular-nums', isToday(d) && 'bg-foreground font-semibold text-background')}>{format(d, 'd')}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
        <div className="px-1 py-1 text-right text-[11px] text-muted-foreground">종일</div>
        {days.map((d) => {
          const k = dayKey(d);
          return (
            <div key={k} className="min-h-8 space-y-0.5 border-l border-border p-0.5">
              {events.filter((e) => e.allDay && eventDays(e).includes(k)).map((e) => <EventChip key={e.id} e={e} onOpen={() => onOpen(e.id)} />)}
              {tasks.filter((t) => t.dueDate.slice(0, 10) === k).map((t) => <TaskChip key={t.id} t={t} />)}
            </div>
          );
        })}
      </div>
      <div className="max-h-[36rem] overflow-y-auto">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height: HOUR_PX * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</div>
            ))}
          </div>
          {days.map((d) => {
            const k = dayKey(d);
            return (
              <div key={k} className="relative border-l border-border">
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    disabled={!onCreate}
                    onClick={() => onCreate?.(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h))}
                    className="absolute inset-x-0 border-t border-border/60 hover:bg-muted/40 disabled:hover:bg-transparent"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                    aria-label={`${format(d, 'M월 d일')} ${h}시 일정 추가`}
                    tabIndex={-1}
                  />
                ))}
                {(layout.get(k) ?? []).map(({ e, top, height, lane, lanes }) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onOpen(e.id)}
                    className={cn('absolute overflow-hidden rounded-md border border-background bg-foreground px-1.5 py-0.5 text-left text-[11px] leading-tight text-background', e.myResponse === 'PENDING' && 'border-dashed border-foreground bg-background text-foreground', e.myResponse === 'DECLINED' && 'opacity-40')}
                    style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 1px)`, width: `calc(${100 / lanes}% - 2px)` }}
                    title={`${e.title} · ${rangeLabel(e)}`}
                  >
                    <span className="block truncate font-medium">{e.isPrivate ? '🔒 ' : ''}{e.title}</span>
                    {height > 30 && <span className="block truncate opacity-80">{timeLabel(e)}{e.location ? ` · ${e.location}` : ''}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [showTasks, setShowTasks] = useState(true);
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState<Date | null>(null);
  const eventId = params.get('event');
  const canWrite = can('calendar.write');

  const { from, to } = useMemo(() => {
    if (mode === 'month') return { from: startOfWeek(startOfMonth(cursor)), to: addDays(endOfWeek(endOfMonth(cursor)), 1) };
    const s = startOfWeek(cursor);
    return { from: s, to: addDays(s, 7) };
  }, [mode, cursor]);
  const q = useEvents(from, to, { tasks: showTasks && can('projects.read'), mine });
  const invitations = useInvitations();
  const m = useCalendarMutations();

  const setEvent = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set('event', id);
    else sp.delete('event');
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };
  const nav = (dir: -1 | 1) => setCursor(mode === 'month' ? (dir < 0 ? subMonths(cursor, 1) : addMonths(cursor, 1)) : dir < 0 ? subWeeks(cursor, 1) : addWeeks(cursor, 1));
  const title = mode === 'month' ? format(cursor, 'yyyy년 M월', { locale: ko }) : `${format(from, 'yyyy년 M월 d일', { locale: ko })} – ${format(addDays(from, 6), 'M월 d일', { locale: ko })}`;
  const events = q.data?.events ?? [];
  const tasks = q.data?.tasks ?? [];

  return (
    <>
      <PageHeader
        title="캘린더"
        description="팀 일정과 내 업무 마감일을 한눈에 확인하세요."
        actions={canWrite && <Button onClick={() => setCreating(new Date())}><Plus />새 일정</Button>}
      />
      <DevStatus status="PARTIAL">
        월간·주간 보기, 일정 생성/편집/삭제, 참석자 초대·응답, 비공개 일정, 업무 마감일 표시가 동작합니다. 후속: 반복 일정(RRULE) 전개, 드래그로 일정 시간 변경, 외부 캘린더 연동.
      </DevStatus>

      {(invitations.data?.length ?? 0) > 0 && (
        <section aria-labelledby="inv-h" className="mb-5 rounded-lg border border-border p-4">
          <h2 id="inv-h" className="mb-3 text-sm font-semibold">응답 대기 중인 초대 {invitations.data!.length}건</h2>
          <ul className="divide-y divide-border">
            {invitations.data!.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setEvent(e.id)} className="min-w-0 text-left text-sm">
                  <span className="block truncate font-medium hover:underline">{e.title}</span>
                  <span className="text-xs text-muted-foreground">{rangeLabel(e)}{e.location ? ` · ${e.location}` : ''}</span>
                </button>
                <div className="flex shrink-0 gap-1.5">
                  {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((r) => (
                    <Button key={r} size="sm" variant={r === 'ACCEPTED' ? 'default' : 'outline'} onClick={() => m.respond.mutate({ id: e.id, response: r })}>{RESPONSE_LABELS[r]}</Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="이전" onClick={() => nav(-1)}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>오늘</Button>
          <Button variant="ghost" size="icon-sm" aria-label="다음" onClick={() => nav(1)}><ChevronRight /></Button>
          <h2 className="ml-2 text-base font-semibold" aria-live="polite">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {can('projects.read') && (
            <label className="flex items-center gap-2"><Switch checked={showTasks} onCheckedChange={setShowTasks} />업무 마감일</label>
          )}
          <label className="flex items-center gap-2"><Switch checked={mine} onCheckedChange={setMine} />내 일정만</label>
          <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="보기 전환">
            {(['month', 'week'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={cn('rounded-md px-3 py-1 text-[13px] font-medium', mode === k ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {k === 'month' ? '월' : '주'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className={cn('transition-opacity', q.isFetching && 'opacity-70')}>
          {mode === 'month' ? (
            <MonthGrid month={cursor} events={events} tasks={tasks} onOpen={setEvent} onCreate={canWrite ? setCreating : undefined} />
          ) : (
            <WeekGrid weekStart={from} events={events} tasks={tasks} onOpen={setEvent} onCreate={canWrite ? setCreating : undefined} />
          )}
          {!q.isLoading && events.length === 0 && tasks.length === 0 && (
            <p className="mt-3 text-center text-sm text-muted-foreground">이 기간에 표시할 일정이 없습니다.{canWrite && ' 날짜를 눌러 일정을 추가하세요.'}</p>
          )}
        </div>
      )}

      <EventDialog
        open={!!eventId || !!creating}
        eventId={eventId}
        initialDate={creating}
        canWrite={canWrite}
        onClose={() => {
          setCreating(null);
          setEvent(null);
        }}
      />
    </>
  );
}
