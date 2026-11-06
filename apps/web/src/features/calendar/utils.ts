import { addDays, format } from 'date-fns';
import type { CalendarEvent } from './api';

export const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/** 일정이 걸쳐 있는 날짜 키 목록. 종일 일정은 저장된 UTC 날짜 기준, 시간 일정은 현지 시간 기준 */
export function eventDays(e: CalendarEvent): string[] {
  let start: Date;
  let end: Date;
  if (e.allDay) {
    start = new Date(`${e.startAt.slice(0, 10)}T00:00:00`);
    end = new Date(`${e.endAt.slice(0, 10)}T00:00:00`);
  } else {
    start = new Date(e.startAt);
    end = new Date(new Date(e.endAt).getTime() - 1);
    if (end < start) end = start;
  }
  const out: string[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < 400; i++) {
    out.push(dayKey(cur));
    if (dayKey(cur) >= dayKey(end)) break;
    cur = addDays(cur, 1);
  }
  return out;
}

export function timeLabel(e: CalendarEvent): string {
  if (e.allDay) return '종일';
  return format(new Date(e.startAt), 'HH:mm');
}

export function rangeLabel(e: CalendarEvent): string {
  if (e.allDay) {
    const s = e.startAt.slice(0, 10).replace(/-/g, '.');
    const en = e.endAt.slice(0, 10).replace(/-/g, '.');
    return s === en ? `${s} (종일)` : `${s} – ${en} (종일)`;
  }
  const s = new Date(e.startAt);
  const en = new Date(e.endAt);
  const sameDay = dayKey(s) === dayKey(en);
  return `${format(s, 'yyyy.MM.dd HH:mm')} – ${format(en, sameDay ? 'HH:mm' : 'yyyy.MM.dd HH:mm')}`;
}
