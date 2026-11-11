'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, History, ImagePlus, Images, RotateCcw, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, apiGet, apiPost, type Paginated } from '@/lib/api';
import { isCmsSite } from '@/lib/site-mode';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { errorMessage, fmtDateTime, useCmsPerms } from './shared';

export interface CmsMedia {
  id: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  originalName: string | null;
  alt: string | null;
  createdAt: string;
}

const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_EDGE = 2560;

/**
 * 업로드 전 브라우저에서 축소 (서버 한도 4MB · 최대 2560px).
 * 서버는 받은 이미지를 다시 검사·재인코딩하므로 이 단계는 용량 절감용이다(보안 경계 아님).
 */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // GIF 등은 그대로 (서버에서 첫 프레임 변환)
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_UPLOAD) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q));
    if (blob && blob.size <= MAX_UPLOAD) return blob;
  }
  return file;
}

export async function uploadImage(file: File, alt?: string): Promise<CmsMedia> {
  const blob = await shrink(file);
  if (blob.size > MAX_UPLOAD) throw new Error('이미지는 4MB 이하만 업로드할 수 있습니다.');
  const fd = new FormData();
  fd.append('file', blob, file.name);
  if (alt) fd.append('alt', alt);
  return api<CmsMedia>('/cms/media', { method: 'POST', body: fd });
}

/** 이미지 라이브러리 (업로드된 이미지 재사용) */
function MediaLibrary({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (m: CmsMedia) => void }) {
  const q = useQuery({ queryKey: ['cms', 'media'], queryFn: () => apiGet<Paginated<CmsMedia>>('/cms/media', { pageSize: 60 }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>이미지 라이브러리</DialogTitle>
          <DialogDescription>업로드한 이미지를 선택해 재사용합니다. 모든 이미지는 서버에서 WebP 로 재인코딩되어 저장됩니다.</DialogDescription>
        </DialogHeader>
        {q.isLoading && <LoadingRows />}
        {q.error && <ErrorState error={q.error} />}
        {q.data && q.data.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">업로드한 이미지가 없습니다.</p>}
        {q.data && q.data.items.length > 0 && (
          <ul className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
            {q.data.items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="group block w-full overflow-hidden rounded-md border border-border text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => { onPick(m); onOpenChange(false); }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt ?? ''} className="aspect-[4/3] w-full bg-muted object-cover transition-opacity group-hover:opacity-80" loading="lazy" />
                  <span className="block truncate px-2 py-1 text-[11px] text-muted-foreground">{m.originalName ?? '이미지'} · {m.width}×{m.height}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 이미지 필드: 업로드 · 라이브러리에서 선택 · URL 직접 입력 · 제거 */
export function ImageField({
  id, label, value, onChange, hint, disabled,
}: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const qc = useQueryClient();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const m = await uploadImage(file);
      onChange(m.url);
      void qc.invalidateQueries({ queryKey: ['cms', 'media'] });
      toast.success('이미지를 업로드했습니다. 저장해야 반영됩니다.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Field label={label} htmlFor={id} hint={hint ?? 'JPG·PNG·WebP·GIF, 4MB 이하 (자동 축소·WebP 변환)'}>
      <div className="space-y-2">
        {value && (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="max-h-36 max-w-full rounded-md border border-border bg-muted object-contain" />
            {!disabled && (
              <button type="button" aria-label={`${label} 제거`} onClick={() => onChange('')} className="absolute -right-2 -top-2 rounded-full border border-border bg-background p-1 shadow-sm hover:bg-muted">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Input id={id} type="url" className="min-w-0 flex-1" placeholder="https://" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
          {!disabled && (
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => fileRef.current?.click()}>
                {value ? <ImagePlus /> : <Upload />} {value ? '교체' : '업로드'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLibOpen(true)}><Images /> 라이브러리</Button>
            </>
          )}
        </div>
      </div>
      <MediaLibrary open={libOpen} onOpenChange={setLibOpen} onPick={(m) => onChange(m.url)} />
    </Field>
  );
}

interface Revision {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  created: '생성', updated: '수정', draft_saved: '초안 저장', draft_discarded: '초안 되돌림', published: '게시', unpublished: '게시 중단', restored: '복구',
  'status:DRAFT': '초안으로', 'status:REVIEW': '검토 요청', 'status:PUBLISHED': '게시', 'status:ARCHIVED': '보관',
};

/** 변경 이력 · 이전 버전 복구 (복구는 초안으로 — 페이지는 다시 게시해야 공개 반영) */
export function RevisionHistory({ entityType, entityId, label = '변경 이력' }: { entityType: 'page' | 'brand' | 'portfolio' | 'post' | 'business_area'; entityId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const { canWrite } = useCmsPerms();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['cms', 'revisions', entityType, entityId],
    queryFn: () => apiGet<Revision[]>('/cms/revisions', { entityType, entityId }),
    enabled: open,
  });
  const restore = async (r: Revision) => {
    if (!window.confirm(`${fmtDateTime(r.createdAt)} 버전으로 복구할까요?\n현재 내용은 이력에 남아 있어 다시 되돌릴 수 있습니다.${entityType === 'page' ? '\n페이지는 초안으로 복구되며, 게시해야 공개 사이트에 반영됩니다.' : ''}`)) return;
    setPending(r.id);
    try {
      await apiPost(`/cms/revisions/${r.id}/restore`);
      toast.success('이전 버전으로 복구했습니다.');
      void qc.invalidateQueries({ queryKey: ['cms'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}><History /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>변경 이력</DialogTitle>
            <DialogDescription>저장·게시·상태 변경 시점의 내용이 기록됩니다. 최근 100건.</DialogDescription>
          </DialogHeader>
          {q.isLoading && <LoadingRows />}
          {q.error && <ErrorState error={q.error} />}
          {q.data && q.data.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">기록된 이력이 없습니다.</p>}
          {q.data && q.data.length > 0 && (
            <ol className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {q.data.map((r, i) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{ACTION_LABELS[r.action] ?? r.action}{i === 0 && <span className="ml-2 text-xs text-muted-foreground">(최신)</span>}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)} · {r.actor?.name ?? '시스템'}</p>
                  </div>
                  {canWrite && i > 0 && (
                    <Button type="button" size="sm" variant="outline" loading={pending === r.id} disabled={!!pending} onClick={() => restore(r)}>
                      <RotateCcw /> 이 버전으로 복구
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 발행 전 미리보기 (CMS 배포 전용): 새 탭에서 초안이 반영된 공개 페이지를 연다 */
export function PreviewButton({ path, label = '미리보기' }: { path: string; label?: string }) {
  if (!isCmsSite) return null;
  return (
    <Button asChild size="sm" variant="ghost">
      <a href={`/admin/preview?path=${encodeURIComponent(path)}`} target="_blank" rel="noopener">
        <Eye /> {label}
      </a>
    </Button>
  );
}
