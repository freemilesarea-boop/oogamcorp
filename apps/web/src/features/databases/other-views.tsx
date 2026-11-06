'use client';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CellDisplay } from './cells';
import type { ViewProps } from './table-view';
import type { DbProperty, DbRow } from './types';

const titleOf = (title: DbProperty | undefined, r: DbRow) => (title && String(r.cells[title.id] ?? '')) || '제목 없음';

/** 캘린더 보기: 날짜 속성 기준 월간 그리드 */
export function CalendarView({ properties, rows, canEdit, mutations, onOpenRow, dateProp }: ViewProps & { dateProp?: DbProperty }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const title = properties.find((p) => p.type === 'TITLE');
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, DbRow[]>();
    if (!dateProp) return map;
    for (const r of rows) {
      const v = r.cells[dateProp.id] as { start?: string; end?: string } | undefined;
      if (!v?.start) continue;
      const s = v.start.slice(0, 10);
      const e = (v.end ?? v.start).slice(0, 10);
      let cur = new Date(`${s}T00:00:00`);
      for (let i = 0; i < 62; i++) {
        const key = format(cur, 'yyyy-MM-dd');
        map.set(key, [...(map.get(key) ?? []), r]);
        if (key >= e) break;
        cur = addDays(cur, 1);
      }
    }
    return map;
  }, [rows, dateProp]);

  if (!dateProp) return <EmptyState title="캘린더에 사용할 날짜 속성이 없습니다" description="'날짜' 타입 속성을 추가한 뒤 이 보기에서 사용하세요." />;

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">{format(month, 'yyyy년 M월', { locale: ko })}</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="이전 달" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft /></Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>오늘</Button>
          <Button variant="ghost" size="icon-sm" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border text-center text-xs text-muted-foreground">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className={cn('group min-h-24 border-b border-r border-border p-1 text-xs [&:nth-child(7n)]:border-r-0', !isSameMonth(d, month) && 'bg-muted/30 text-muted-foreground')}>
              <div className="mb-1 flex items-center justify-between">
                <span className={cn('flex size-6 items-center justify-center rounded-full tabular-nums', isToday(d) && 'bg-foreground font-semibold text-background')}>{format(d, 'd')}</span>
                {canEdit && (
                  <button type="button" onClick={() => mutations.createRow.mutate({ [dateProp.id]: { start: key } })} className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100" aria-label={`${key}에 항목 추가`}>
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
              <ul className="space-y-0.5">
                {items.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpenRow(r.id)} className="block w-full truncate rounded bg-muted px-1.5 py-0.5 text-left hover:bg-gray-200 dark:hover:bg-gray-800">{titleOf(title, r)}</button>
                  </li>
                ))}
                {items.length > 4 && <li className="px-1.5 text-muted-foreground">+{items.length - 4}개</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 리스트 보기 */
export function ListView({ properties, rows, onOpenRow, visible }: ViewProps & { visible: DbProperty[] }) {
  const title = properties.find((p) => p.type === 'TITLE');
  const extra = visible.filter((p) => p.type !== 'TITLE').slice(0, 4);
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpenRow(r.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1 truncate font-medium">{titleOf(title, r)}</span>
            <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {extra.map((p) => <span key={p.id} className="flex max-w-48 items-center"><CellDisplay prop={p} value={r.cells[p.id]} /></span>)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 갤러리 보기 (카드) */
export function GalleryView({ properties, rows, onOpenRow, visible }: ViewProps & { visible: DbProperty[] }) {
  const title = properties.find((p) => p.type === 'TITLE');
  const extra = visible.filter((p) => p.type !== 'TITLE');
  if (!rows.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onOpenRow(r.id)} className="flex flex-col rounded-lg border border-border bg-card p-4 text-left text-sm transition-shadow hover:shadow-md">
          <span className="mb-2 line-clamp-2 font-semibold">{titleOf(title, r)}</span>
          <span className="space-y-1.5">
            {extra.map((p) => {
              const v = r.cells[p.id];
              if (v === undefined || v === null) return null;
              return (
                <span key={p.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 truncate text-muted-foreground">{p.name}</span>
                  <span className="min-w-0 flex-1"><CellDisplay prop={p} value={v} /></span>
                </span>
              );
            })}
          </span>
        </button>
      ))}
    </div>
  );
}
