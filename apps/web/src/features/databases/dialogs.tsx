'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import type { DbMutations } from './api';
import { VIEW_TYPE_LABELS, type DbView, type ImportResult, type ViewType } from './types';

/** 뷰 추가/이름 변경 */
export function ViewDialog({ open, onOpenChange, view, canEdit, mutations, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  view: DbView | null;
  canEdit: boolean;
  mutations: DbMutations;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ViewType>('TABLE');
  const [personal, setPersonal] = useState(!canEdit);
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? '');
    setType(view?.type ?? 'TABLE');
    setPersonal(view ? view.personal : !canEdit);
  }, [open, view, canEdit]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (view) await mutations.updateView.mutateAsync({ viewId: view.id, name });
    else {
      const created = await mutations.createView.mutateAsync({ name, type, personal });
      onCreated(created.id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{view ? '뷰 이름 변경' : '새 뷰'}</DialogTitle>
            <DialogDescription>공유 뷰는 데이터베이스를 볼 수 있는 모든 사람에게, 개인 뷰는 나에게만 보입니다.</DialogDescription>
          </DialogHeader>
          <Field label="이름" htmlFor="view-name">
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
          </Field>
          {!view && (
            <>
              <Field label="보기 형식" htmlFor="view-type">
                <NativeSelect id="view-type" value={type} onChange={(e) => setType(e.target.value as ViewType)}>
                  {Object.entries(VIEW_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}{k === 'TIMELINE' ? ' (화면 후속 구현)' : ''}</option>)}
                </NativeSelect>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={personal} disabled={!canEdit} onCheckedChange={(c) => setPersonal(c === true)} />
                개인 뷰 (나만 보기){!canEdit && <span className="text-xs text-muted-foreground">— 편집 권한이 없어 개인 뷰만 만들 수 있습니다</span>}
              </label>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={mutations.createView.isPending || mutations.updateView.isPending}>{view ? '저장' : '만들기'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** CSV 가져오기 (multipart, 최대 5MB) */
export function ImportDialog({ open, onOpenChange, mutations }: { open: boolean; onOpenChange: (o: boolean) => void; mutations: DbMutations }) {
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);
  const tooBig = !!file && file.size > 5 * 1024 * 1024;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>CSV 가져오기</DialogTitle>
          <DialogDescription>첫 행은 속성 이름이어야 합니다. 각 값은 속성 타입에 맞게 검증되며, 오류가 있는 행은 건너뜁니다. 선택 옵션은 자동으로 추가됩니다.</DialogDescription>
        </DialogHeader>
        {!result ? (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file || tooBig) return;
              setResult(await mutations.importCsv.mutateAsync({ file, createMissing }));
            }}
          >
            <Field label="CSV 파일" htmlFor="csv-file" error={tooBig ? '파일은 최대 5MB 입니다.' : undefined}>
              <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createMissing} onCheckedChange={(c) => setCreateMissing(c === true)} />
              없는 속성은 텍스트 속성으로 새로 만들기
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
              <Button type="submit" disabled={!file || tooBig} loading={mutations.importCsv.isPending}>가져오기</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              <strong className="tabular-nums">{result.imported}</strong>행을 가져왔습니다.
              {result.failedRows > 0 && <> 오류로 <strong className="tabular-nums">{result.failedRows}</strong>행을 건너뛰었습니다.</>}
              {result.createdProperties.length > 0 && <> 새 속성: {result.createdProperties.join(', ')}</>}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1.5">행</th><th className="px-2 py-1.5">열</th><th className="px-2 py-1.5">오류</th></tr></thead>
                  <tbody>
                    {result.errors.map((er, i) => (
                      <tr key={i} className="border-t border-border"><td className="px-2 py-1 tabular-nums">{er.row}</td><td className="px-2 py-1">{er.column ?? '-'}</td><td className="px-2 py-1">{er.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <DialogFooter><Button onClick={() => onOpenChange(false)}>닫기</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
