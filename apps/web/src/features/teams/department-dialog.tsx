'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiPatch, apiPost } from '@/lib/api';
import { descendantIds, type Department } from './types';

export function DepartmentDialog({ open, onOpenChange, departments, editing, defaultParentId, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
  editing: Department | null;
  defaultParentId?: string | null;
  onSaved?: (d: Department) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', code: '', description: '', parentId: '', managerId: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing
      ? { name: editing.name, code: editing.code ?? '', description: editing.description ?? '', parentId: editing.parentId ?? '', managerId: editing.managerId ?? '' }
      : { name: '', code: '', description: '', parentId: defaultParentId ?? '', managerId: '' });
  }, [open, editing, defaultParentId]);
  const excluded = editing ? descendantIds(departments, editing.id) : new Set<string>();
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), code: form.code.trim() || (editing ? null : undefined), description: form.description.trim() || (editing ? null : undefined), parentId: form.parentId || (editing ? null : undefined), managerId: form.managerId || (editing ? null : undefined) };
      return editing ? apiPatch<Department>(`/departments/${editing.id}`, body) : apiPost<Department>('/departments', body);
    },
    onSuccess: (d) => {
      toast.success(editing ? '부서를 수정했습니다.' : '부서를 만들었습니다.');
      void qc.invalidateQueries({ queryKey: ['departments'] });
      void qc.invalidateQueries({ queryKey: ['directory'] });
      onSaved?.(d);
      onOpenChange(false);
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '부서 수정' : '새 부서'}</DialogTitle>
          <DialogDescription>상위 부서를 지정해 조직 구조를 구성할 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!form.name.trim()) { setError('부서명을 입력하세요.'); return; } save.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="부서명" htmlFor="dept-name"><Input id="dept-name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="코드" htmlFor="dept-code"><Input id="dept-code" value={form.code} maxLength={30} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          </div>
          <Field label="상위 부서" htmlFor="dept-parent">
            <NativeSelect id="dept-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">없음 (최상위)</option>
              {departments.filter((d) => !excluded.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="부서장">
            <UserPicker multiple={false} value={form.managerId ? [form.managerId] : []} onChange={(ids) => setForm({ ...form, managerId: ids[0] ?? '' })} placeholder="부서장 선택 (선택)" />
          </Field>
          <Field label="설명" htmlFor="dept-desc"><Textarea id="dept-desc" value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={save.isPending}>{editing ? '저장' : '만들기'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
