'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Lock, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useDepartments } from '@/lib/directory';
import { ACCESS_LABEL, docKeys, useInvalidateDocs, VISIBILITY_LABEL, type AccessInfo, type AccessLevel, type Visibility } from '../api';

const LEVELS: AccessLevel[] = ['VIEW', 'COMMENT', 'EDIT', 'FULL'];

/** 공유 및 권한: 공개 범위 + 사용자/부서별 접근 수준 (FULL 권한 필요, 서버에서 강제) */
export function ShareDialog({ pageId, open, onOpenChange, canManage }: { pageId: string; open: boolean; onOpenChange: (o: boolean) => void; canManage: boolean }) {
  const qc = useQueryClient();
  const invalidateDocs = useInvalidateDocs();
  const info = useQuery({ queryKey: docKeys.access(pageId), queryFn: () => apiGet<AccessInfo>(`/documents/${pageId}/access`), enabled: open && canManage });
  const { data: departments = [] } = useDepartments();
  const [mode, setMode] = useState<'user' | 'dept'>('user');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [deptId, setDeptId] = useState('');
  const [level, setLevel] = useState<AccessLevel>('VIEW');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: docKeys.access(pageId) });
    qc.invalidateQueries({ queryKey: docKeys.doc(pageId) });
    invalidateDocs();
  };
  const onError = (e: unknown) => toast.error((e as Error).message);
  const setVisibility = useMutation({ mutationFn: (visibility: Visibility) => apiPatch(`/documents/${pageId}/visibility`, { visibility }), onSuccess: refresh, onError });
  const addGrant = useMutation({
    mutationFn: (body: { userId?: string; departmentId?: string; access: AccessLevel }) => apiPost(`/documents/${pageId}/access/grants`, body),
    onSuccess: () => { refresh(); setUserIds([]); setDeptId(''); },
    onError,
  });
  const removeGrant = useMutation({ mutationFn: (gid: string) => apiDelete(`/documents/${pageId}/access/grants/${gid}`), onSuccess: refresh, onError });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>공유 및 권한</DialogTitle>
          <DialogDescription>문서를 볼 수 있는 범위와 사용자별 권한을 설정합니다. 변경 내역은 감사 로그에 기록됩니다.</DialogDescription>
        </DialogHeader>
        {!canManage ? (
          <p className="rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">이 문서의 권한은 작성자 또는 전체 권한을 가진 사용자만 관리할 수 있습니다.</p>
        ) : info.isLoading ? <LoadingRows rows={3} /> : info.isError ? <ErrorState error={info.error} /> : info.data && (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">공개 범위</legend>
              <div className="space-y-1.5">
                {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                  <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 has-[:checked]:border-foreground">
                    <input type="radio" name="visibility" className="mt-1 accent-current" checked={info.data!.visibility === v} disabled={setVisibility.isPending} onChange={() => setVisibility.mutate(v)} />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {v === 'PRIVATE' ? <Lock className="size-3.5" /> : v === 'RESTRICTED' ? <Users className="size-3.5" /> : <Building2 className="size-3.5" />}
                        {VISIBILITY_LABEL[v].label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{VISIBILITY_LABEL[v].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <section aria-labelledby="grant-add">
              <h3 id="grant-add" className="mb-2 text-sm font-medium">사용자 · 부서 추가</h3>
              <div className="mb-2 flex gap-1 text-xs" role="radiogroup" aria-label="대상 유형">
                {(['user', 'dept'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md border px-2 py-1 ${mode === m ? 'border-foreground' : 'border-border text-muted-foreground'}`}>
                    {m === 'user' ? '사용자' : '부서'}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  {mode === 'user' ? (
                    <UserPicker value={userIds} onChange={setUserIds} multiple={false} placeholder="사용자 선택" exclude={[info.data.owner?.id ?? '']} />
                  ) : (
                    <NativeSelect value={deptId} onChange={(e) => setDeptId(e.target.value)} aria-label="부서 선택">
                      <option value="">부서 선택</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </NativeSelect>
                  )}
                </div>
                <NativeSelect value={level} onChange={(e) => setLevel(e.target.value as AccessLevel)} className="sm:w-32" aria-label="접근 수준">
                  {LEVELS.map((l) => <option key={l} value={l}>{ACCESS_LABEL[l]}</option>)}
                </NativeSelect>
                <Button
                  disabled={mode === 'user' ? !userIds[0] : !deptId}
                  loading={addGrant.isPending}
                  onClick={() => addGrant.mutate(mode === 'user' ? { userId: userIds[0], access: level } : { departmentId: deptId, access: level })}
                >
                  추가
                </Button>
              </div>
            </section>

            <section aria-labelledby="grant-list">
              <h3 id="grant-list" className="mb-2 text-sm font-medium">접근 권한이 있는 사용자</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {info.data.owner && (
                  <li className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar name={info.data.owner.name} src={info.data.owner.avatarUrl} className="size-6" />
                    <span className="flex-1 truncate text-sm">{info.data.owner.name}</span>
                    <span className="text-xs text-muted-foreground">작성자 · 전체 권한</span>
                  </li>
                )}
                {info.data.grants.map((g) => (
                  <li key={g.id} className="flex items-center gap-2.5 px-3 py-2">
                    {g.user ? <Avatar name={g.user.name} src={g.user.avatarUrl} className="size-6" /> : <span className="flex size-6 items-center justify-center rounded-full bg-muted"><Building2 className="size-3.5" /></span>}
                    <span className="flex-1 truncate text-sm">{g.user?.name ?? g.department?.name ?? '-'}{g.department && <span className="text-xs text-muted-foreground"> (부서)</span>}</span>
                    <NativeSelect
                      value={g.access}
                      className="h-8 w-28 text-xs"
                      aria-label={`${g.user?.name ?? g.department?.name} 접근 수준`}
                      onChange={(e) => addGrant.mutate({ ...(g.user ? { userId: g.user.id } : { departmentId: g.department!.id }), access: e.target.value as AccessLevel })}
                    >
                      {LEVELS.map((l) => <option key={l} value={l}>{ACCESS_LABEL[l]}</option>)}
                    </NativeSelect>
                    <button type="button" onClick={() => removeGrant.mutate(g.id)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" aria-label="권한 제거"><Trash2 className="size-4" /></button>
                  </li>
                ))}
                {info.data.grants.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">추가로 공유된 사용자가 없습니다.</li>}
              </ul>
              {info.data.visibility === 'WORKSPACE' && <p className="mt-2 text-xs text-muted-foreground">워크스페이스 공개 상태에서는 구성원 전체가 기본 권한을 가집니다. 개별 권한은 그보다 높은 권한을 줄 때 사용합니다.</p>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
