'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Lock, MapPin, Repeat, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { UserPicker } from '@/components/admin/user-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar, Checkbox, Switch } from '@/components/ui/misc';
import { RESPONSE_LABELS, useCalendarMutations, useEvent, type AttendeeResponse, type CalendarEvent } from './api';
import { rangeLabel } from './utils';

const RECURRENCES: { value: string; label: string }[] = [
  { value: '', label: '반복 안 함' },
  { value: 'FREQ=DAILY', label: '매일' },
  { value: 'FREQ=WEEKLY', label: '매주' },
  { value: 'FREQ=MONTHLY', label: '매월' },
  { value: 'FREQ=YEARLY', label: '매년' },
];

const schema = z
  .object({
    title: z.string().trim().min(1, '제목을 입력하세요.').max(200),
    allDay: z.boolean(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일을 입력하세요.'),
    startTime: z.string(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '종료일을 입력하세요.'),
    endTime: z.string(),
    location: z.string().max(300),
    description: z.string().max(5000),
    isPrivate: z.boolean(),
    recurrence: z.string().max(500),
    attendeeIds: z.array(z.string()).max(200),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay && (!/^\d{2}:\d{2}$/.test(v.startTime) || !/^\d{2}:\d{2}$/.test(v.endTime))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: '시간을 입력하세요.' });
      return;
    }
    const s = v.allDay ? v.startDate : `${v.startDate}T${v.startTime}`;
    const e = v.allDay ? v.endDate : `${v.endDate}T${v.endTime}`;
    if (e < s) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '종료는 시작 이후여야 합니다.' });
  });
type FormValues = z.infer<typeof schema>;

function defaults(ev: CalendarEvent | undefined, date: Date | null): FormValues {
  if (ev) {
    const s = new Date(ev.startAt);
    const e = new Date(ev.endAt);
    return {
      title: ev.title,
      allDay: ev.allDay,
      startDate: ev.allDay ? ev.startAt.slice(0, 10) : format(s, 'yyyy-MM-dd'),
      startTime: ev.allDay ? '09:00' : format(s, 'HH:mm'),
      endDate: ev.allDay ? ev.endAt.slice(0, 10) : format(e, 'yyyy-MM-dd'),
      endTime: ev.allDay ? '10:00' : format(e, 'HH:mm'),
      location: ev.location ?? '',
      description: ev.description ?? '',
      isPrivate: ev.isPrivate,
      recurrence: ev.recurrence ?? '',
      attendeeIds: ev.attendees.map((a) => a.id),
    };
  }
  const d = date ?? new Date();
  const hour = date && (date.getHours() || date.getMinutes()) ? date.getHours() : 9;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    title: '', allDay: false, startDate: format(d, 'yyyy-MM-dd'), startTime: `${pad(hour)}:00`, endDate: format(d, 'yyyy-MM-dd'), endTime: `${pad(Math.min(hour + 1, 23))}:${hour + 1 > 23 ? '59' : '00'}`,
    location: '', description: '', isPrivate: false, recurrence: '', attendeeIds: [],
  };
}

function toPayload(v: FormValues) {
  return {
    title: v.title.trim(),
    allDay: v.allDay,
    startAt: v.allDay ? v.startDate : new Date(`${v.startDate}T${v.startTime}`).toISOString(),
    endAt: v.allDay ? v.endDate : new Date(`${v.endDate}T${v.endTime}`).toISOString(),
    location: v.location.trim() || null,
    description: v.description.trim() || null,
    isPrivate: v.isPrivate,
    recurrence: v.recurrence || null,
    attendeeIds: v.attendeeIds,
  };
}

const RESPONSE_VARIANT: Record<AttendeeResponse, 'success' | 'danger' | 'warning' | 'muted'> = { ACCEPTED: 'success', DECLINED: 'danger', TENTATIVE: 'warning', PENDING: 'muted' };

/** 일정 상세/생성/편집. 작성자만 편집, 참석자는 응답 */
export function EventDialog({ open, eventId, initialDate, canWrite, onClose }: {
  open: boolean;
  eventId: string | null;
  initialDate: Date | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const ev = useEvent(eventId);
  const m = useCalendarMutations();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(undefined, initialDate) });
  const { register, handleSubmit, control, watch, reset, formState: { errors } } = form;

  useEffect(() => {
    if (open) reset(defaults(eventId ? ev.data : undefined, initialDate));
  }, [open, eventId, ev.data, initialDate, reset]);

  const allDay = watch('allDay');
  const recurrence = watch('recurrence');
  const event = eventId ? ev.data : undefined;
  const editable = eventId ? !!event?.canEdit && canWrite : canWrite;

  const onSubmit = handleSubmit(async (v) => {
    const body = toPayload(v);
    if (eventId) await m.update.mutateAsync({ id: eventId, ...body });
    else await m.create.mutateAsync(body);
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{eventId ? (editable ? '일정 편집' : event?.title ?? '일정') : '새 일정'}</DialogTitle>
          <DialogDescription>{event ? rangeLabel(event) : '참석자에게 알림이 전송됩니다.'}</DialogDescription>
        </DialogHeader>

        {eventId && ev.isError && <p className="text-sm text-muted-foreground">일정을 찾을 수 없거나 볼 권한이 없습니다.</p>}

        {event && !editable && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {event.isPrivate && <Badge variant="muted"><Lock className="size-3" />비공개</Badge>}
              {event.recurrence && <Badge variant="muted"><Repeat className="size-3" />반복 (전개 후속 구현)</Badge>}
            </div>
            {event.location && <p className="flex items-center gap-1.5"><MapPin className="size-4 text-muted-foreground" />{event.location}</p>}
            {event.description && <p className="whitespace-pre-wrap">{event.description}</p>}
          </div>
        )}

        {event && event.attendees.length > 0 && (
          <section aria-labelledby="attendees-h" className="space-y-2">
            <h3 id="attendees-h" className="text-sm font-medium">참석자 {event.attendees.length}명</h3>
            <ul className="flex flex-wrap gap-2">
              {event.attendees.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2 text-xs">
                  <Avatar name={a.name} src={a.avatarUrl} className="size-5" />
                  {a.name}
                  <Badge variant={RESPONSE_VARIANT[a.response]}>{RESPONSE_LABELS[a.response]}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {event && event.myResponse && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
            <span className="mr-1">참석하시나요?</span>
            {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((r) => (
              <Button key={r} size="sm" variant={event.myResponse === r ? 'default' : 'outline'} loading={m.respond.isPending && m.respond.variables?.response === r} onClick={() => m.respond.mutate({ id: event.id, response: r }, { onSuccess: () => void ev.refetch() })}>
                {RESPONSE_LABELS[r]}
              </Button>
            ))}
          </div>
        )}

        {editable && (!eventId || event) && (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="제목" htmlFor="ev-title" error={errors.title?.message}>
              <Input id="ev-title" {...register('title')} maxLength={200} autoFocus />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Controller control={control} name="allDay" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="종일" />} />
              종일
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="시작" htmlFor="ev-sd" error={errors.startDate?.message}>
                <div className="flex gap-2">
                  <Input id="ev-sd" type="date" {...register('startDate')} />
                  {!allDay && <Input type="time" aria-label="시작 시간" {...register('startTime')} className="w-32" />}
                </div>
              </Field>
              <Field label="종료" htmlFor="ev-ed" error={errors.endDate?.message ?? errors.endTime?.message}>
                <div className="flex gap-2">
                  <Input id="ev-ed" type="date" {...register('endDate')} />
                  {!allDay && <Input type="time" aria-label="종료 시간" {...register('endTime')} className="w-32" />}
                </div>
              </Field>
            </div>
            <Field label="참석자" hint="초대된 사람에게 알림이 전송됩니다.">
              <Controller control={control} name="attendeeIds" render={({ field }) => <UserPicker value={field.value} onChange={field.onChange} placeholder="참석자 선택" />} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="장소" htmlFor="ev-loc"><Input id="ev-loc" {...register('location')} maxLength={300} /></Field>
              <Field label="반복" htmlFor="ev-rec" hint={recurrence ? '반복 규칙은 저장되지만 캘린더에 반복 전개는 후속 구현입니다.' : undefined}>
                <NativeSelect id="ev-rec" {...register('recurrence')}>
                  {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  {recurrence && !RECURRENCES.some((r) => r.value === recurrence) && <option value={recurrence}>사용자 정의 ({recurrence})</option>}
                </NativeSelect>
              </Field>
            </div>
            <Field label="설명" htmlFor="ev-desc"><Textarea id="ev-desc" rows={3} {...register('description')} maxLength={5000} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <Controller control={control} name="isPrivate" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />} />
              비공개 (작성자와 참석자만 볼 수 있음)
            </label>
            <DialogFooter className="sm:justify-between">
              {eventId ? (
                <Button type="button" variant="ghost" className="text-danger" loading={m.remove.isPending} onClick={() => {
                  if (!window.confirm('이 일정을 삭제할까요? 참석자에게 취소 알림이 전송됩니다.')) return;
                  m.remove.mutate(eventId, { onSuccess: onClose });
                }}><Trash2 />삭제</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>취소</Button>
                <Button type="submit" loading={m.create.isPending || m.update.isPending}>{eventId ? '저장' : '만들기'}</Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
