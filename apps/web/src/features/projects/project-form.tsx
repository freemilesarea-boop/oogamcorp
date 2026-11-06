'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { PRIORITIES, PRIORITY_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@oogam/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiPatch, apiPost } from '@/lib/api';
import { useDepartments } from '@/lib/directory';
import { toDateInput } from '@/lib/utils';
import type { ProjectDetail } from './types';

const schema = z
  .object({
    name: z.string().trim().min(1, '프로젝트명을 입력하세요.').max(200),
    key: z.string().regex(/^([A-Z][A-Z0-9]{1,9})?$/, '영문 대문자로 시작하는 2~10자 (선택)').optional(),
    description: z.string().max(10000).optional(),
    status: z.enum(PROJECT_STATUSES),
    priority: z.enum(PRIORITIES),
    departmentId: z.string().optional(),
    managerId: z.array(z.string()),
    memberIds: z.array(z.string()),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { path: ['endDate'], message: '종료일은 시작일 이후여야 합니다.' });

type Values = z.infer<typeof schema>;

export function ProjectFormDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: ProjectDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: departments = [] } = useDepartments();
  const { register, handleSubmit, control, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    values: project
      ? {
          name: project.name, key: project.key, description: project.description ?? '', status: project.status, priority: project.priority,
          departmentId: project.department?.id ?? '', managerId: project.manager ? [project.manager.id] : [], memberIds: [],
          startDate: toDateInput(project.startDate), endDate: toDateInput(project.endDate),
        }
      : { name: '', key: '', description: '', status: 'PLANNING', priority: 'MEDIUM', departmentId: '', managerId: [], memberIds: [], startDate: '', endDate: '' },
  });

  const mutation = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name,
        description: v.description || undefined,
        status: v.status,
        priority: v.priority,
        departmentId: v.departmentId || undefined,
        managerId: v.managerId[0] || undefined,
        startDate: v.startDate || undefined,
        endDate: v.endDate || undefined,
      };
      return project
        ? apiPatch<{ id: string }>(`/projects/${project.id}`, { ...body, description: v.description ?? null, startDate: v.startDate || null, endDate: v.endDate || null })
        : apiPost<{ id: string }>('/projects', { ...body, key: v.key || undefined, memberIds: v.memberIds });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(project ? '프로젝트를 수정했습니다.' : '프로젝트를 만들었습니다.');
      onOpenChange(false);
      reset();
      if (!project) router.push(`/admin/projects/${p.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{project ? '프로젝트 수정' : '새 프로젝트'}</DialogTitle>
          <DialogDescription>담당 부서, 관리자, 일정과 우선순위를 지정하세요.</DialogDescription>
        </DialogHeader>
        <form id="project-form" onSubmit={handleSubmit((v) => mutation.mutate(v))} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="프로젝트명" htmlFor="p-name" error={formState.errors.name?.message}><Input id="p-name" {...register('name')} autoFocus /></Field></div>
          {!project && <Field label="프로젝트 키 (선택)" htmlFor="p-key" error={formState.errors.key?.message} hint="예: WEB. 비우면 자동 생성"><Input id="p-key" {...register('key')} placeholder="WEB" /></Field>}
          <Field label="담당 부서" htmlFor="p-dept">
            <NativeSelect id="p-dept" {...register('departmentId')}>
              <option value="">(내 부서)</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="상태" htmlFor="p-status">
            <NativeSelect id="p-status" {...register('status')}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}</NativeSelect>
          </Field>
          <Field label="우선순위" htmlFor="p-priority">
            <NativeSelect id="p-priority" {...register('priority')}>{PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}</NativeSelect>
          </Field>
          <Field label="시작일" htmlFor="p-start"><Input id="p-start" type="date" {...register('startDate')} /></Field>
          <Field label="종료일" htmlFor="p-end" error={formState.errors.endDate?.message}><Input id="p-end" type="date" {...register('endDate')} /></Field>
          <Field label="프로젝트 관리자">
            <Controller control={control} name="managerId" render={({ field }) => <UserPicker multiple={false} value={field.value} onChange={field.onChange} placeholder="(나)" />} />
          </Field>
          {!project && (
            <Field label="참여 직원">
              <Controller control={control} name="memberIds" render={({ field }) => <UserPicker value={field.value} onChange={field.onChange} placeholder="참여자 선택" />} />
            </Field>
          )}
          <div className="sm:col-span-2"><Field label="설명" htmlFor="p-desc"><Textarea id="p-desc" rows={4} {...register('description')} /></Field></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="submit" form="project-form" loading={mutation.isPending}>{project ? '저장' : '만들기'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
