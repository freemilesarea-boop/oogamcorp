'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

export type AttendeeResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  isPrivate: boolean;
  projectId: string | null;
  departmentId: string | null;
  recurrence: string | null;
  createdById: string;
  attendees: { id: string; name: string; email: string; avatarUrl: string | null; response: AttendeeResponse }[];
  myResponse: AttendeeResponse | null;
  canEdit: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  priority: string;
  project: { id: string; key: string; name: string } | null;
  href: string;
}

export interface EventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  isPrivate: boolean;
  recurrence?: string | null;
  attendeeIds: string[];
}

export const RESPONSE_LABELS: Record<AttendeeResponse, string> = { PENDING: '응답 대기', ACCEPTED: '수락', DECLINED: '거절', TENTATIVE: '미정' };

export function useEvents(from: Date, to: Date, opts: { tasks: boolean; mine: boolean }) {
  return useQuery({
    queryKey: ['calendar', 'events', from.toISOString(), to.toISOString(), opts],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<{ events: CalendarEvent[]; tasks: TaskItem[] }>('/calendar/events', {
        from: from.toISOString(),
        to: to.toISOString(),
        include: opts.tasks ? 'tasks' : undefined,
        mine: opts.mine ? 'true' : undefined,
      }),
  });
}

export function useEvent(id: string | null) {
  return useQuery({ queryKey: ['calendar', 'event', id], enabled: !!id, queryFn: () => apiGet<CalendarEvent>(`/calendar/events/${id}`) });
}

export function useInvitations() {
  return useQuery({ queryKey: ['calendar', 'invitations'], queryFn: () => apiGet<CalendarEvent[]>('/calendar/invitations') });
}

export function useCalendarMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  const onError = (e: unknown) => toast.error((e as Error).message);
  return {
    create: useMutation({ mutationFn: (body: EventInput) => apiPost<CalendarEvent>('/calendar/events', body), onSuccess: () => { toast.success('일정을 만들었습니다.'); void refresh(); }, onError }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<EventInput> & { id: string }) => apiPatch<CalendarEvent>(`/calendar/events/${id}`, body), onSuccess: () => { toast.success('일정을 저장했습니다.'); void refresh(); }, onError }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/calendar/events/${id}`), onSuccess: () => { toast.success('일정을 삭제했습니다.'); void refresh(); }, onError }),
    respond: useMutation({
      mutationFn: ({ id, response }: { id: string; response: Exclude<AttendeeResponse, 'PENDING'> }) => apiPost<CalendarEvent>(`/calendar/events/${id}/respond`, { response }),
      onSuccess: refresh,
      onError,
    }),
  };
}
