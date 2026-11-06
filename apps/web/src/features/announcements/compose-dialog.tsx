'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useDepartments } from '@/lib/directory';
import { SCOPE_LABELS, type Announcement, type AnnouncementScope } from './types';

/** 공지 작성/수정. 범위(전사/부서/프로젝트)는 작성 시에만 지정 가능 */
export function ComposeDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Announcement | null }) {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const { data: departments = [] } = useDepartments();
  const projects = useQuery({
    queryKey: ['projects', 'mine', 'for-announcement'],
    queryFn: () => apiGet<Paginated<{ id: string; key: string; name: string }>>('/projects', { mine: 'true', pageSize: 100 }),
    enabled: open && !editing && can('projects.read'),
  });
  const [form, setForm] = useState({ title: '', body: '', scope: 'COMPANY' as AnnouncementScope, departmentId: '', projectId: '', pinned: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing
      ? { title: editing.title, body: editing.body, scope: editing.scope, departmentId: editing.department?.id ?? '', projectId: editing.project?.id ?? '', pinned: editing.pinned }
      : { title: '', body: '', scope: 'COMPANY', departmentId: me.department?.id ?? '', projectId: '', pinned: false });
  }, [open, editing, me.department?.id]);

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch<Announcement>(`/announcements/${editing.id}`, { title: form.title.trim(), body: form.body.trim(), pinned: form.pinned })
      : apiPost<Announcement>('/announcements', {
        title: form.title.trim(), body: form.body.trim(), scope: form.scope, pinned: form.pinned,
        departmentId: form.scope === 'DEPARTMENT' ? form.departmentId : undefined,
        projectId: form.scope === 'PROJECT' ? form.projectId : undefined,
      }),
    onSuccess: () => {
      toast.success(editing ? '공지를 수정했습니다.' : '공지를 게시하고 대상자에게 알림을 보냈습니다.');
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      onOpenChange(false);
    },
    onError: (e) => setError((e as Error).message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return setError('제목과 내용을 입력하세요.');
    if (!editing && form.scope === 'DEPARTMENT' && !form.departmentId) return setError('대상 부서를 선택하세요.');
    if (!editing && form.scope === 'PROJECT' && !form.projectId) return setError('대상 프로젝트를 선택하세요.');
    setError(null);
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{editing ? '공지 수정' : '새 공지'}</DialogTitle>
          <DialogDescription>{editing ? '범위는 변경할 수 없습니다.' : '게시하면 대상 범위의 구성원에게 알림이 전송됩니다.'}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="공지 범위" htmlFor="ann-scope">
                <NativeSelect id="ann-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as AnnouncementScope })}>
                  {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              {form.scope === 'DEPARTMENT' && (
                <Field label="대상 부서" htmlFor="ann-dept">
                  <NativeSelect id="ann-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">선택</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </NativeSelect>
                </Field>
              )}
              {form.scope === 'PROJECT' && (
                <Field label="대상 프로젝트" htmlFor="ann-proj" hint="내가 참여 중인 프로젝트만 선택할 수 있습니다.">
                  <NativeSelect id="ann-proj" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                    <option value="">선택</option>
                    {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )}
          <Field label="제목" htmlFor="ann-title"><Input id="ann-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="내용" htmlFor="ann-body"><Textarea id="ann-body" value={form.body} maxLength={20000} rows={10} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <div className="flex items-center gap-2">
            <Switch id="ann-pin" checked={form.pinned} onCheckedChange={(v) => setForm({ ...form, pinned: v })} />
            <Label htmlFor="ann-pin">상단 고정</Label>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={save.isPending}>{editing ? '저장' : '게시'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
